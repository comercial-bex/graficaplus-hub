import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  PASSO_DA_UNIDADE,
  ROTULO_DA_UNIDADE,
  UNIDADES_DE_MEDIDA,
  avisoDeMedidaSuspeita,
  deMetros,
  lembrarUnidade,
  lerUnidadeLembrada,
  paraMetros,
  textoDoCampo,
  type UnidadeDeMedida,
} from "@/domain/orcamentos/unidade-de-medida";

/**
 * A escolha vale para todos os campos que a leem ao mesmo tempo: quem troca a unidade nas medidas da peça muda
 * também a linha sob a quantidade ("40 peças de 4 × 4 cm"). Cada componente tinha o próprio estado e só o
 * seguinte a montar lia a escolha nova (10/11/2026).
 */
const ouvintes = new Set<() => void>();
/** Só vale quando o armazenamento do navegador não grava (modo privado): a escolha fica nesta tela. */
let escolhaSoDestaTela: UnidadeDeMedida | null = null;

const armazenamento = () => (typeof window === "undefined" ? null : window.localStorage);

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  // Outra aba do mesmo aparelho escolheu: a tela desta também acompanha.
  if (typeof window !== "undefined") window.addEventListener("storage", avisar);
  return () => {
    ouvintes.delete(avisar);
    if (typeof window !== "undefined") window.removeEventListener("storage", avisar);
  };
}

const unidadeAgora = (): UnidadeDeMedida => escolhaSoDestaTela ?? lerUnidadeLembrada(armazenamento());
/** O servidor não tem armazenamento: desenha em metros e o navegador corrige logo depois de montar. */
const unidadeNoServidor = (): UnidadeDeMedida => "m";

/**
 * A unidade em que a pessoa digita a medida, lembrada neste aparelho. Começa em
 * metros (como era) e, depois de a pessoa escolher, vira a escolha dela — o
 * mesmo para o orçamento da equipe e o do parceiro. O servidor e o navegador
 * desenham o mesmo HTML (metros) e o navegador lê a escolha logo depois de montar.
 */
export function useUnidadeDeMedida(): [UnidadeDeMedida, (u: UnidadeDeMedida) => void] {
  const unidade = useSyncExternalStore(assinar, unidadeAgora, unidadeNoServidor);
  const escolher = (u: UnidadeDeMedida) => {
    lembrarUnidade(armazenamento(), u);
    // Se o armazenamento gravou, ele é a verdade; se não, a escolha fica na memória desta tela.
    escolhaSoDestaTela = lerUnidadeLembrada(armazenamento()) === u ? null : u;
    ouvintes.forEach((avisar) => avisar());
  };
  return [unidade, escolher];
}

/** mm | cm | m, num grupo só: uma escolha, três toques no máximo. */
export function SeletorDeUnidade({
  valor,
  onMudar,
  desabilitado = false,
  className,
}: {
  valor: UnidadeDeMedida;
  onMudar: (u: UnidadeDeMedida) => void;
  desabilitado?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Unidade das medidas"
      className={cn("inline-flex rounded-md border bg-background p-0.5", className)}
    >
      {UNIDADES_DE_MEDIDA.map((u) => {
        const ativa = u === valor;
        return (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={ativa}
            disabled={desabilitado}
            aria-label={`${u}, ${ROTULO_DA_UNIDADE[u]}`}
            onClick={() => onMudar(u)}
            className={cn(
              "min-h-11 min-w-11 rounded px-3 text-xs font-semibold transition-colors sm:min-h-7 sm:min-w-9 sm:px-2.5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              ativa ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {u}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Um campo de medida: a pessoa digita na unidade escolhida, e quem usa o campo
 * continua recebendo METROS (texto com ponto, como o resto do sistema).
 *
 * O texto digitado fica aqui dentro — reescrever o campo a cada tecla a partir
 * dos metros comeria a vírgula de "80," antes do "5" de "80,5". Ele só é refeito
 * quando o valor de fora deixa de ser o que o texto diz (tamanho pronto aplicado,
 * item aberto para editar, formulário limpo) ou quando a unidade troca: trocar de
 * cm para m mantém a PEÇA e muda como ela é escrita.
 */
export function CampoDeMedida({
  id,
  rotulo,
  metros,
  unidade,
  onMudar,
  desabilitado = false,
  className,
}: {
  id: string;
  rotulo: string;
  /** O valor guardado, em metros ("" quando vazio). */
  metros: string;
  unidade: UnidadeDeMedida;
  /** Recebe metros ("" quando a pessoa apaga). */
  onMudar: (metros: string) => void;
  desabilitado?: boolean;
  className?: string;
}) {
  const [texto, setTexto] = useState(() => deMetros(paraMetros(metros, "m"), unidade));
  const ultimaUnidade = useRef(unidade);

  useEffect(() => {
    const trocouDeUnidade = ultimaUnidade.current !== unidade;
    ultimaUnidade.current = unidade;
    const novo = textoDoCampo({ texto, metrosDeFora: metros, unidade, trocouDeUnidade });
    if (novo !== texto) setTexto(novo);
    // `texto` fica de fora de propósito: este efeito só reage ao que vem de fora.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metros, unidade]);

  const emMetros = paraMetros(texto, unidade);
  const aviso = avisoDeMedidaSuspeita(rotulo.replace(/\s*\(.*\)$/, ""), emMetros, unidade);

  return (
    <div className={className}>
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          min="0"
          step={PASSO_DA_UNIDADE[unidade]}
          inputMode="decimal"
          placeholder="0"
          className={cn("h-11 pr-10 sm:h-9", aviso && "border-amber-500 focus-visible:ring-amber-500")}
          value={texto}
          disabled={desabilitado}
          aria-describedby={aviso ? `${id}-aviso` : undefined}
          aria-invalid={aviso ? true : undefined}
          onChange={(e) => {
            setTexto(e.target.value);
            const m = paraMetros(e.target.value, unidade);
            onMudar(m === null ? "" : String(m));
          }}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {unidade}
        </span>
      </div>
      {aviso && (
        <p id={`${id}-aviso`} role="status" className="mt-1 text-xs text-amber-600">
          {aviso}
        </p>
      )}
    </div>
  );
}
