# Локальный image scan: вход, эффекты и отказы

WMS-602.3 реализует локальную подготовку поставки. Пользователь подтвердил GitHub Actions + GHCR; после локальной подготовки новым поручением разрешил реальный release и проверку pull.
Доступы и целевой cluster не проверены. Внешние Actions,
публикация и registry pull не выполнены. [Команды и установка](../../scripts/image-release/README.md),
[AC и review](../reports/wms-602.md).

```mermaid
flowchart TD
  A[Image gates: clean backend/web build] --> B[Docker inspect: точный local image ID]
  B --> C[Docker save по ID в private UUID directory]
  C --> D[Trivy: OS/library и полный JSON]
  D --> P[Runtime probe без сети и записи]
  P --> E{Структура, identity, severity и exact waiver}
  E -->|Нет blocking findings| F[Summary passed с hash отчёта]
  E -->|Нарушение| G[Summary failed, nonzero]
  D -->|Ошибка binary, DB или timeout| G
  F --> H[Удалить tar в finally]
  G --> H
```

1. Оператор запускает image gates и `pnpm images:scan`. Скрипт требует Trivy 0.76.2.
   Нет доступа к Docker/DB — отказ, без fallback. Оператор доверяет scanner executable
   и публичной vulnerability DB. Складские credentials не передаются scanner.
2. `main` создаёт artifacts/image-scan/UUID и summary running через общий atomic writer.
   На hard kill running не считается успехом. Запуски не используют общий latest.
3. `scanImage` читает Docker inspect ID фиксированного local tag. Далее export идёт
   по ID: замена tag другим процессом не меняет проверяемый образ.
4. Trivy получает tar, пустой config и environment без TRIVY_*; CLI задаёт OS/library,
   vuln scanner, полный JSON, отсутствие ignorefile и включение unfixed. Сеть нужна
   только scanner DB. После scanner запускается короткий runtime probe без сети/записи; SQL, audit/outbox и миграции не вызываются.
5. `verifyRuntime` проверяет exact base/Node/uid, отсутствие tooling/native addons и shared OpenSSL.
   Исключения применяются только при этих условиях. `validateReport` проверяет schema v2, container_image, Metadata.ImageID, равное config digest archive bytes,
   непустой OS result и структуру vulnerabilities. Например, HIGH CVE без FixedVersion
   даёт отказ; LOW остаётся в отчёте и counts. Только пять адресных UNKNOWN могут получить waiver по [review policy](../../scripts/image-release/README.md#runtime-и-review-исключений). Чужой image ID даёт отказ даже без CVE.
6. Успешный результат включает image ID, исходные counts, waived entries, runtime proof, hash policy и SHA-256 JSON. Ошибка прерывает
   следующие images, сохраняет JSON и summary failed; tar удаляется finally.
   После устранения причины нужно повторить всю команду. Старый passed не используется.

Нет общей транзакции image/registry: локальный scan не доказывает внешний push/pull,
соответствие опубликованного manifest проверенному commit или отсутствие всех уязвимостей.
Inspect ID может быть OCI index; Trivy ImageID проверяется по config bytes. Registry manifest digest и целевой pull относятся
к открытым WMS-602.4–602.5. Автоматический внешний rollout в эту подготовку не входит.

## Подготовленные GitHub Actions и GHCR

`validate.yaml` принимает pull_request и workflow_call. Token имеет contents:read;
checkout credentials не сохраняются, actions закреплены exact SHA. Linux tools имеют
pinned versions/checksums. Frozen install и Chromium предшествуют harness plan/run/ready.
После failed gate export checked images не выполняется. Reports сохраняются 7 дней.

`release-images.yaml` принимает только workflow_dispatch на default branch. Validation
повторяется для этого commit; передаются проверенные backend/web tar и SHA256SUMS с
commit.txt. Publish job ждёт validation и environment ghcr-release, имеет packages:write,
но не checkout/исполнение candidate source. Он проверяет hashes/commit, загружает tar,
публикует unique tag sha-COMMIT-run-ID-ATTEMPT, читает registry digest и выполняет pull
по canonical reference. digests.tsv хранится 90 дней и связывает commit/image/digest.
Tags не являются защитой от registry admin: потребитель должен использовать digest.

До первого внешнего запуска оператор должен настроить environment ghcr-release с
required reviewers и ограничением default branch, разрешить GitHub Packages для repo
и проверить visibility/access. Имя environment в YAML само по себе review не обеспечивает.
Не добавлять PAT в build args/layers. Для private images целевому cluster нужен отдельный
read:packages credential через Secret вне Git. Runner pull не доказывает cluster pull.

После отдельно разрешённой публикации: скачать release-digests/validation-evidence
одного run; сверить commit с проверенным checkout; получить `IMAGE@sha256:...` из TSV;
в целевом окружении выполнить `docker pull IMAGE@sha256:...` либо проверить Pod
imageID при отдельно разрешённом rollout. Зафиксировать architecture, digest, commit,
run URL, pull identity и exit status без credentials. Этот шаг сейчас не выполняется.
Частичный push backend до отказа web не откатывается: не считать такую пару release;
сохранить digests/logs, исправить причину и повторить validation с новым unique tag.

Подход согласован с [GitHub GHCR documentation](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)
и [Trivy filtering](https://trivy.dev/docs/latest/configuration/filtering/).
