# Общая конфигурация Kafka adapters

## Бизнес-назначение

Publisher и consumer используют один transport security policy: только явные brokers
и mTLS. Неверная конфигурация не должна приводить к plaintext или утечке credentials.

## Техническое устройство

`kafka-connection.config.ts` предоставляет kafkaBrokers/kafkaTls. Первая функция
проверяет формат host:port, вторая читает CA/client certificate/private key и проверяет
TLS context при startup. Значения возвращаются адаптеру процесса; логирование отсутствует.
KafkaConnectionError содержит только brokers/tls. Publisher переводит его в прежние
публичные codes, consumer выводит статический startup failure. Runtime I/O не выполняется
из бизнес-транзакции. Rotations требуют перезапуска процесса.

Пример: `kafkaBrokers('broker:9093')` → `['broker:9093']`; порт0, URL с credential
и отсутствующий PEM → ошибка. Проверки — publisher.spec.ts, kafka-consumer-config.spec.ts
и kafka-consumer.spec.ts. TLS здесь не проверяет Kafka ACL: это задача broker/Strimzi.
