/** @file Внутренний trusted principal после проверки сессии; это не HTTP input и не ORM-модель. */

/** Principal существует только после проверки сессии; содержит ID, не session token/password hash. */
export interface Principal {
  /** UUID активного пользователя из server-side lookup, не actorId из body. */
  readonly userId: string;
  /** Несекретный UUID session row для повторной проверки/отзыва, не browser token. */
  readonly sessionId: string;
}
