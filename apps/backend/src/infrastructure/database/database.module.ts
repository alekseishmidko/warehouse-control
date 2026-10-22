/** @file Nest-адаптер PostgreSQL: startup check, DI и освобождение pool при shutdown. */
import { Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { loadEnvironment, RuntimeConfig } from '../config/environment';
import { createDatabaseConnection } from './connection';
import { PostgresTransactionRunner } from './postgres-transaction-runner';
import { TRANSACTION_RUNNER } from '../../shared/transactions/transaction.port';

/** DI token проверенной конфигурации: тесты заменяют его без изменения process.env. */
export const DATABASE_CONFIG = Symbol('DATABASE_CONFIG');

/** Владеет одним pool процесса; не мигрирует БД и не изменяет бизнес-данные при запуске. */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly connection;
  /** Typed Drizzle handle для адаптеров; владение pool и его закрытием остаётся у сервиса. */
  readonly db;

  /** Принимает validated config от Nest provider; создаёт pool без подключения до init. */
  constructor(@Inject(DATABASE_CONFIG) config: RuntimeConfig) {
    this.connection = createDatabaseConnection(config.databaseUrl);
    this.db = this.connection.db;
  }

  /** Проверяет доступность БД до открытия HTTP; ошибка не раскрывает драйверный payload. */
  async onModuleInit(): Promise<void> {
    try {
      await this.connection.pool.query('select 1');
    } catch {
      await this.connection.pool.end();
      throw new Error('Database startup connection failed');
    }
  }

  /** Дожидается возврата клиентов и закрывает соединения при штатном завершении Nest. */
  async onModuleDestroy(): Promise<void> {
    if (!this.connection.pool.ended) await this.connection.pool.end();
  }
}

/** Предоставляет database adapter будущим модулям; не является generic repository. */
@Module({
  providers: [
    { provide: DATABASE_CONFIG, useFactory: loadEnvironment },
    DatabaseService,
    {
      provide: TRANSACTION_RUNNER,
      useFactory: (database: DatabaseService) => new PostgresTransactionRunner(database.db),
      inject: [DatabaseService],
    },
  ],
  exports: [DATABASE_CONFIG, DatabaseService, TRANSACTION_RUNNER],
})
export class DatabaseModule {}
