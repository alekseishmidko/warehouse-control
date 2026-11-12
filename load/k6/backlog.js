/** @file WMS-403.2: фиксированные 100 приёмок при остановленном worker; drain измеряет driver. */
import { receive, optionsFor, summary } from './common.js';
export const options = optionsFor('backlog');
export default function () {
  receive();
}
export const handleSummary = summary;
