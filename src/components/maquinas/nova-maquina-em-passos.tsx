/* eslint-disable @typescript-eslint/no-explicit-any -- payload dinâmico, como o cadastro de antes */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Box, Cog, Printer, Scissors, Zap, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AssistenteEmPassos } from "@/components/bex/assistente-em-passos";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  maquinaDasRespostas,
  minutosPorM2,
  nomeSugerido,
  PASSOS_DA_MAQUINA,
  pendenciaDoPassoDaMaquina,
  RESPOSTAS_VAZIAS_DA_MAQUINA,
  respostasDoTipo,
  TIPOS_DE_MAQUINA,
  type NumeroDoPasso,
  type RespostasDaMaquina,
} from "@/domain/maquinas/nova-maquina-em-passos";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";

const ICONES: Record<string, LucideIcon> = { Printer, Scissors, Zap, Box };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Nova máquina em passos: tipo, identificação, capacidade, custo e consumo, revisão. Os números
 * de capacidade e de consumo são os que o orçamento e o custo cheio usam, então cada passo diz
 * para que serve o que pede.
 */
export function NovaMaquinaEmPassos({
  aberto,
  onFechar,
  onAbrirCadastroCompleto,
}: {
  aberto: boolean;
  onFechar: () => void;
  onAbrirCadastroCompleto: () => void;
}) {
  const qc = useQueryClient();
  const { canSeeFinancials } = useAuth();
  const [r, setR] = useState<RespostasDaMaquina>(RESPOSTAS_VAZIAS_DA_MAQUINA);
  const [passo, setPasso] = useState<NumeroDoPasso>(1);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setR(RESPOSTAS_VAZIAS_DA_MAQUINA);
      setPasso(1);
    }
  }, [aberto]);

  const pendencia = pendenciaDoPassoDaMaquina(passo, r);
  const tipo = r.tipo;
  const velocidade = Number(r.velocidade_m2_h.replace(",", ".")) || 0;
  const campo = (
    id: string,
    rotulo: string,
    k: keyof RespostasDaMaquina,
    extra?: object,
    ajuda?: string,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <Input
        id={id}
        value={r[k] as string}
        onChange={(e) => setR({ ...r, [k]: e.target.value })}
        {...extra}
      />
      {ajuda && <p className="text-xs text-muted-foreground">{ajuda}</p>}
    </div>
  );

  async function criar() {
    setCriando(true);
    try {
      const { error } = await (supabase as any)
        .from("maquinas")
        .insert(maquinaDasRespostas(r, canSeeFinancials));
      if (error) throw error;
      toast.success("Máquina cadastrada");
      qc.invalidateQueries({ queryKey: ["maquinas"] });
      qc.invalidateQueries({ queryKey: ["maquinas-para-produto"] });
      onFechar();
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setCriando(false);
    }
  }

  return (
    <AssistenteEmPassos
      aberto={aberto}
      onFechar={onFechar}
      titulo="Nova máquina em passos"
      passos={PASSOS_DA_MAQUINA}
      atual={passo}
      onIr={(n) => setPasso(n as NumeroDoPasso)}
      pendencia={passo === 1 ? null : pendencia}
      semAvancar={passo === 1}
      rotuloCriar="Cadastrar máquina"
      criando={criando}
      onCriar={criar}
      testId="nova-maquina-em-passos"
    >
      {passo === 1 && (
        <GradeDeCartoes rotulo="Tipo de máquina">
          {TIPOS_DE_MAQUINA.map((t) => {
            const Icone = ICONES[t.icone] ?? Cog;
            return (
              <CartaoDeEscolha
                key={t.chave}
                ativo={tipo?.chave === t.chave}
                titulo={t.titulo}
                detalhe={t.detalhe}
                icone={<Icone className="h-8 w-8 text-muted-foreground" />}
                onEscolher={() => {
                  setR(respostasDoTipo(r, t));
                  setPasso(2);
                }}
              />
            );
          })}
          <CartaoDeEscolha
            ativo={false}
            titulo="Outra"
            detalhe="cadastro completo, campo a campo"
            icone={<Cog className="h-8 w-8 text-muted-foreground" />}
            onEscolher={() => {
              onFechar();
              onAbrirCadastroCompleto();
            }}
          />
        </GradeDeCartoes>
      )}

      {passo === 2 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {campo("nm-fab", "Fabricante", "fabricante")}
          {campo("nm-modelo", "Modelo", "modelo")}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nm-nome">Nome *</Label>
            <Input
              id="nm-nome"
              value={r.nome}
              placeholder={nomeSugerido(r)}
              onChange={(e) => setR({ ...r, nome: e.target.value })}
            />
            {!r.nome.trim() && nomeSugerido(r) && (
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setR({ ...r, nome: nomeSugerido(r) })}
              >
                Usar "{nomeSugerido(r)}"
              </button>
            )}
          </div>
          {campo(
            "nm-serie",
            "Número de série",
            "numero_serie",
            undefined,
            "É por ele que se abre chamado de garantia no fabricante.",
          )}
        </div>
      )}

      {passo === 3 && tipo && (
        <div className="space-y-4">
          {tipo.temLarguraUtil && (
            <div className="space-y-1.5">
              <Label>Largura útil (a boca da máquina), em m</Label>
              {tipo.largurasComuns && (
                <GradeDeCartoes rotulo="Largura útil">
                  {tipo.largurasComuns.map((l) => (
                    <CartaoDeEscolha
                      key={l}
                      ativo={Number(r.largura_util_m.replace(",", ".")) === l}
                      titulo={`${l.toLocaleString("pt-BR")} m`}
                      className="min-h-14"
                      onEscolher={() => setR({ ...r, largura_util_m: String(l) })}
                    />
                  ))}
                </GradeDeCartoes>
              )}
              <Input
                aria-label="Largura útil, em metros"
                className="max-w-40"
                inputMode="decimal"
                placeholder="Outra, em m"
                value={r.largura_util_m}
                onChange={(e) => setR({ ...r, largura_util_m: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                É o limite do encaixe da bobina no orçamento.
              </p>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {tipo.temVelocidade &&
              campo(
                "nm-vel",
                "Velocidade (m²/h) *",
                "velocidade_m2_h",
                { inputMode: "decimal" },
                velocidade > 0
                  ? `${minutosPorM2(velocidade).toLocaleString("pt-BR")} min por m²`
                  : "Dá o tempo de máquina de cada pedido.",
              )}
            {tipo.temVelocidade &&
              campo("nm-avanco", "Avanço entre peças (m)", "avanco_m", { inputMode: "decimal" })}
            {campo("nm-disp", "Disponibilidade (%)", "disponibilidade_pct", {
              inputMode: "numeric",
            })}
          </div>
        </div>
      )}

      {passo === 4 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {campo(
            "nm-kw",
            "Potência (kW)",
            "potencia_kw",
            { inputMode: "decimal" },
            "O sistema soma a energia (kW × tarifa) ao custo.",
          )}
          {canSeeFinancials &&
            campo(
              "nm-custo",
              "Custo por hora (R$)",
              "custo_hora",
              { inputMode: "decimal" },
              "Depreciação, manutenção e rateio; a energia vai à parte.",
            )}
          {campo(
            "nm-setup",
            "Preparo (min)",
            "setup_min",
            { inputMode: "numeric" },
            "Tempo para preparar a máquina a cada trabalho.",
          )}
        </div>
      )}

      {passo === 5 && (
        <dl className="grid gap-x-4 gap-y-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
          <Linha rotulo="Tipo" valor={tipo?.titulo ?? ""} />
          <Linha rotulo="Nome" valor={r.nome.trim()} />
          <Linha
            rotulo="Fabricante e modelo"
            valor={[r.fabricante, r.modelo].filter(Boolean).join(" ") || "não informado"}
          />
          <Linha
            rotulo="Largura útil"
            valor={r.largura_util_m ? `${r.largura_util_m} m` : "não informada"}
          />
          {tipo?.temVelocidade && (
            <Linha rotulo="Velocidade" valor={`${velocidade.toLocaleString("pt-BR")} m²/h`} />
          )}
          <Linha
            rotulo="Potência"
            valor={r.potencia_kw ? `${r.potencia_kw} kW` : "não informada"}
          />
          {canSeeFinancials && (
            <Linha
              rotulo="Custo por hora"
              valor={
                Number(r.custo_hora.replace(",", ".")) > 0
                  ? brl(Number(r.custo_hora.replace(",", ".")))
                  : "não informado"
              }
            />
          )}
        </dl>
      )}
    </AssistenteEmPassos>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right font-medium">{valor}</dd>
    </div>
  );
}
