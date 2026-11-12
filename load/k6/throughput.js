/** @file WMS-403.1: независимые SKU/склады, 10 приёмок/с, максимум 4 VU; невыполненный входной поток — отказ. */
import { receive, optionsFor, summary } from './common.js';
export const options = optionsFor('throughput');
export default function () {
  receive();
}
export const handleSummary = summary;
