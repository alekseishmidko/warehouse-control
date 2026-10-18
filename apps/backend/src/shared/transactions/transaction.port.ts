/** @file Независимый от транспорта/ORM контракт атомарного application-сценария. */
declare const transactionContextBrand: unique symbol;

/** Непрозрачная capability активной транзакции; передаётся явно, не содержит публичного DB handle. */
export interface TransactionContext {
  readonly [transactionContextBrand]: true;
}

/** DI token прикладного transaction port; реализация регистрируется инфраструктурой. */
export const TRANSACTION_RUNNER = Symbol('TRANSACTION_RUNNER');

/** Один вызов — одна транзакция. Все операции callback должны быть awaited; ошибок нельзя скрывать. */
export interface TransactionRunner {
  /** Commit после успешного callback, rollback при исключении; вложенный run запрещён, auto retry отсутствует. */
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}
