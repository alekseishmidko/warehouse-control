/** @file Статическое приветствие API; складской бизнес-логики и I/O нет. */
import { Injectable } from '@nestjs/common';

/** Предоставляет имя API стартовому контроллеру. */
@Injectable()
export class AppService {
  /** Возвращает статический текст без побочных эффектов. */
  getHello(): string {
    return 'Warehouse Controller API';
  }
}
