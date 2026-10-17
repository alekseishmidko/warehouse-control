# 0005. Docker, Kubernetes и Nginx

- Дата: 2026-10-17
- Статус: Accepted

## Контекст

Пользователь сознательно добавил практику контейнеризации и оркестрации.

## Решение

Docker multi-stage/non-root, Compose для разработки, kind для Kubernetes.
Helm для ресурсов приложения, Gateway API и NGINX Gateway Fabric для HTTP.
Strimzi для будущего Kafka-стенда. API/worker разделены, миграции отдельным Job.

## Альтернативы

Только Compose не покрывает учебную цель Kubernetes. Устаревший community
ingress-nginx не используем; NGINX Gateway Fabric — другой проект.
Managed infrastructure рассматривается отдельно при внешнем размещении.

## Последствия и проверка

Растут требования к памяти и сопровождению; нужны профили запуска.
Dev-кластер с одной репликой не доказывает HA. Проверить чистую установку,
SIGTERM, rollout и восстановление worker. Этапы 1, 3, 5.

Источники: [Gateway Fabric](https://docs.nginx.com/nginx-gateway-fabric),
[retirement ingress-nginx](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/).
