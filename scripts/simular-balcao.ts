/**
 * Roda os cenários de balcão e escreve a tabela em Markdown.
 *   npx tsx scripts/simular-balcao.ts            # tabela resumida
 *   npx tsx scripts/simular-balcao.ts --detalhe  # avisos de cada cenário
 *   npx tsx scripts/simular-balcao.ts --estoque  # estoque mínimo e ponto de aviso por material
 */
import { CENARIOS } from "../src/domain/simulacao/cenarios-de-balcao";
import {
  DIA_TIPICO,
  necessidadeDeEstoque,
  PREMISSAS_DE_ESTOQUE,
} from "../src/domain/simulacao/planejamento-de-estoque";
import { simularPedido } from "../src/domain/simulacao/simulador-de-balcao";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const min = (n: number) => `${Math.round(n)} min`;
const detalhe = process.argv.includes("--detalhe");

if (process.argv.includes("--estoque")) {
  const premissas = PREMISSAS_DE_ESTOQUE;
  console.log(
    `Um dia de balcão = ${DIA_TIPICO.join(", ")}, uma vez cada. Reposição ${premissas.prazoDeReposicaoDias} dias, aviso a ${premissas.avisoPct * 100}% do estoque cheio, ${premissas.diasUteisPorMes} dias úteis.\n`,
  );
  console.log(
    "| Material | Consumo/dia | Consumo/mês | Cobre o prazo | Estoque cheio | Avisar abaixo de |",
  );
  console.log("|---|---:|---:|---:|---:|---:|");
  const m2 = (n: number) => `${n.toLocaleString("pt-BR")} m²`;
  for (const n of necessidadeDeEstoque(CENARIOS.filter((c) => DIA_TIPICO.includes(c.id)))) {
    console.log(
      `| ${n.nome} | ${m2(n.consumoDiaM2)} | ${m2(n.consumoMesM2)} | ${m2(n.consumoNoPrazoM2)} | ${m2(n.estoqueCheioM2)} | ${m2(n.avisoEmM2)} |`,
    );
  }
  process.exit(0);
}

console.log(
  "| # | Cenário | Área | Produtos | Taxa 12% | Máquina | Mão de obra | Relógio | Gargalo | Material (m²) | Expresso |",
);
console.log("|---|---|---:|---:|---:|---:|---:|---:|---|---|---|");
for (const c of CENARIOS) {
  // A taxa e o "cabe no expresso" são calculados como se o pedido fosse em expresso, mesmo nos cenários normais.
  // O estoque é simulado: o consumo sai na coluna Material e vira o planejamento de estoque (--estoque).
  const r = simularPedido(c.itens, { ...c.opcoes, prazo: "expresso" });
  const t = r.tempos;
  const veredito = r.expresso.possivel
    ? `cabe (folga ${min(r.expresso.folgaMin)})`
    : `NÃO — ${r.expresso.motivos[0]}`;
  const material = Object.entries(r.material.consumoM2)
    .map(([m, v]) => `${m.replace("_", " ")} ${v.toLocaleString("pt-BR")}`)
    .join("; ");
  console.log(
    `| ${c.id} | ${c.titulo} | ${r.areaM2.toLocaleString("pt-BR")} m² | ${brl(r.produtos)} | ${brl(r.taxaExpresso)} | ${min(t.impressaoMin + t.recorteMin)} | ${min(t.maoDeObraMin)} | ${min(t.totalRelogioMin)} | ${t.gargalo === "maquina" ? "máquina" : "mão de obra"} | ${material} | ${veredito} |`,
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
