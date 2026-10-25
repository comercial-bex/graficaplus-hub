/**
 * Roda os cenários de balcão e escreve a tabela em Markdown.
 *   npx tsx scripts/simular-balcao.ts            # tabela resumida
 *   npx tsx scripts/simular-balcao.ts --detalhe  # avisos de cada cenário
 */
import { CENARIOS } from "../src/domain/simulacao/cenarios-de-balcao";
import { simularPedido } from "../src/domain/simulacao/simulador-de-balcao";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const min = (n: number) => `${Math.round(n)} min`;
const detalhe = process.argv.includes("--detalhe");

console.log(
  "| # | Cenário | Área | Produtos | Taxa 12% | Máquina | Mão de obra | Relógio | Gargalo | Expresso hoje | Expresso c/ estoque cheio |",
);
console.log("|---|---|---:|---:|---:|---:|---:|---:|---|---|---|");
for (const c of CENARIOS) {
  // A taxa e o "cabe no expresso" são calculados como se o pedido fosse em expresso, mesmo nos cenários normais.
  const hoje = simularPedido(c.itens, { ...c.opcoes, prazo: "expresso", estoque: "real" });
  const cheio = simularPedido(c.itens, { ...c.opcoes, prazo: "expresso", estoque: "abastecido" });
  const t = hoje.tempos;
  const veredito = (r: typeof hoje) =>
    r.expresso.possivel
      ? `cabe (folga ${min(r.expresso.folgaMin)})`
      : `NÃO — ${r.expresso.motivos[0]}`;
  console.log(
    `| ${c.id} | ${c.titulo} | ${hoje.areaM2.toLocaleString("pt-BR")} m² | ${brl(hoje.produtos)} | ${brl(hoje.taxaExpresso)} | ${min(t.impressaoMin + t.recorteMin)} | ${min(t.maoDeObraMin)} | ${min(t.totalRelogioMin)} | ${t.gargalo === "maquina" ? "máquina" : "mão de obra"} | ${veredito(hoje)} | ${veredito(cheio)} |`,
  );
}
if (detalhe) {
  for (const c of CENARIOS) {
    const r = simularPedido(c.itens, c.opcoes);
    console.log(`\n### ${c.id} — ${c.titulo}\nProcura: ${c.procura}`);
    for (const a of r.avisos) console.log(`- [${a.codigo}] ${a.mensagem}`);
    if (!r.expresso.possivel) console.log(`- EXPRESSO NÃO: ${r.expresso.motivos.join("; ")}`);
  }
}
