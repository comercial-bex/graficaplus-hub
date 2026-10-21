import { Crosshair, Cuboid, Factory, Printer, Scissors, Sun, Zap } from "lucide-react";
import { DicaIcone } from "@/components/bex/Dica";
import type { IdentidadeMaquina } from "@/domain/producao/identidade-da-maquina";

/**
 * O selo da máquina: ícone e cor.
 *
 * Existe porque o quadro NÃO divide coluna por máquina. Cinco colunas por etapa
 * já é o limite do que se lê num olhar; dividir a Produção nos cinco caminhos
 * daria dez colunas e devolveria o problema que acabamos de resolver. O caminho
 * da peça é dito aqui, dentro do cartão, por ícone e cor — que se reconhecem
 * sem ler.
 *
 * A escolha do ícone e da cor mora no domínio (testada, inclusive o contraste);
 * aqui fica só a tradução do nome para o componente.
 */
const ICONES = { Printer, Scissors, Zap, Crosshair, Cuboid, Sun, Factory } as const;

export function IconeDaMaquina({
  identidade,
  className = "h-3 w-3",
}: {
  identidade: IdentidadeMaquina;
  className?: string;
}) {
  const Icone = ICONES[identidade.icone] ?? Factory;
  return <Icone className={className} style={{ color: identidade.cor }} aria-hidden />;
}

export function SeloDaMaquina({ identidade }: { identidade: IdentidadeMaquina }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        color: identidade.cor,
        borderColor: `${identidade.cor}55`,
        backgroundColor: `${identidade.cor}1a`,
      }}
    >
      <IconeDaMaquina identidade={identidade} />
      {identidade.curto}
      {/* A observação ("a casa tem dois lasers — o status não diz qual") ficava
          num title atrás de um "!": agora é a dica, que abre no toque também. */}
      {identidade.observacao && (
        <DicaIcone texto={identidade.observacao} rotulo={identidade.curto} className="h-3 w-3" />
      )}
    </span>
  );
}
