import { businessMinutesBetween } from './src/lib/dashboard/business-hours.ts';

// Teste de uma semana (seg 07:00 SP → seg 07:00 SP, uma semana depois)
const from = new Date('2026-08-03T10:00:00Z'); // Seg 07:00 SP
const to = new Date('2026-08-10T10:00:00Z');   // Seg 07:00 SP (1 semana depois)

console.log('Medindo performance para intervalo de 1 semana...');
console.time('1 week interval');
const result = businessMinutesBetween(from, to);
console.timeEnd('1 week interval');
console.log(`Result: ${result} minutos (esperado: 3600 = 5 dias * 12 horas)`);

// Teste de 20 chamadas sequenciais (simulando 20 conversas)
console.log('\nMedindo performance para 20 chamadas sequenciais...');
console.time('20 sequential calls');
for (let i = 0; i < 20; i++) {
  businessMinutesBetween(from, to);
}
console.timeEnd('20 sequential calls');
