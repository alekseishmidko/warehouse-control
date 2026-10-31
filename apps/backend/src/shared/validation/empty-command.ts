/** @file Runtime граница пустых JSON команд: отсутствующее тело/{} допустимо, клиентские поля запрещены. */
import { CommandError } from '../errors/command-error';
/** Не преобразует значения, не выполняет I/O; invalid body вызывает безопасный VALIDATION_FAILED. */
export function requireEmptyCommand(body: unknown): void {
  if (
    body !== undefined &&
    (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)
  )
    throw new CommandError('VALIDATION_FAILED');
}
