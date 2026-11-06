{{/* Одно immutable image значение для API/worker/migrator; рендер без обязательной конфигурации запрещён. */}}
{{- define "warehouse.image" -}}
{{- if eq .Values.database.runtimeSecret .Values.database.migrationSecret -}}
{{- fail "runtime and migration Secret names must differ" -}}
{{- end -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- end -}}
{{/* Общая защищённая sandbox для всех backend-процессов. */}}
{{- define "warehouse.security" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end -}}
{{/* Режим контейнера и auth policy проверяет существующий runtime validator. */}}
{{- define "warehouse.environment" -}}
- name: NODE_ENV
  value: production
- name: HTTP_HOST
  value: 0.0.0.0
- name: PORT
  value: '3000'
- name: DEV_ACTOR_ENABLED
  value: 'false'
- name: OUTBOX_ADMIN_ENABLED
  value: 'false'
- name: AUTH_ORIGIN
  value: {{ .Values.auth.origin | quote }}
- name: AUTH_SESSION_ABSOLUTE_SECONDS
  value: {{ .Values.auth.absoluteSeconds | quote }}
- name: AUTH_SESSION_IDLE_SECONDS
  value: {{ .Values.auth.idleSeconds | quote }}
{{- end -}}

{{/* Для длинного Helm release сохраняем уникальность и DNS label <=63 с revision int64. */}}
{{- define "warehouse.jobPrefix" -}}
{{- if gt (len .Release.Name) 26 -}}
{{- printf "%s-%s" (.Release.Name | trunc 26 | trimSuffix "-") (.Release.Name | sha256sum | trunc 8) -}}
{{- else -}}
{{- .Release.Name -}}
{{- end -}}
{{- end -}}
