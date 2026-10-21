/** @file Регистрация первой доставки: стабильное имя будущего локального handler, без запуска worker. */

/** Логическое имя сохраняется при повторах; новая подписка на историю требует отдельного migration/replay плана. */
export const PUTAWAY_DESTINATION = 'inventory.putaway' as const;

/** Все события receipt направляются в один stream; тип события не используется как фильтр подписки. */
export const RECEIPT_DESTINATIONS = Object.freeze([PUTAWAY_DESTINATION]);

/** Верхняя граница JSON aggregateVersion; SQL bigint хранит значение, JS number читает его без потери точности. */
export const MAX_AGGREGATE_VERSION = Number.MAX_SAFE_INTEGER;
