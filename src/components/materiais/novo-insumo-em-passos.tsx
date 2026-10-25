/* eslint-disable @typescript-eslint/no-explicit-any -- RPC e colunas novas ainda fora de types.ts */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Cylinder,
  Droplets,
  Puzzle,
  Scroll,
  Square,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AssistenteEmPassos } from "@/components/bex/assistente-em-passos";
import { CartaoDeEscolha, GradeDeCartoes } from "@/components/orcamento/cartao-de-escolha";
import { Carregando } from "@/components/bex/Carregando";
import { materiaisParecidos } from "@/domain/materiais/parecidos";
import {
  CHAPAS_COMUNS,
  COMPRIMENTOS_DE_BOBINA_M,
  custoPorUnidade,
  entradaInicial,
  estoqueMinimoDoCheio,
  FRACAO_DO_AVISO_DE_COMPRA,
  LARGURAS_DE_BOBINA_M,
  materialDasRespostas,
  PASSOS_DO_INSUMO,
  pendenciaDoPassoDoInsumo,
  quantidadePorEmbalagem,
  RESPOSTAS_VAZIAS_DO_INSUMO,
  TIPOS_DE_INSUMO,
  type NumeroDoPasso,
  type RespostasDoInsumo,
  type TipoDeInsumo,
  type VarianteDeInsumo,
} from "@/domain/materiais/novo-insumo-em-passos";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { registrarUso } from "@/lib/uso-de-telas";
import { fromFinancialView } from "@/lib/supabase-financial-views";

const ICONES: Record<string, LucideIcon> = { Scroll, Square, Droplets, Cylinder, Puzzle };
const PASSOS: NumeroDoPasso[] = [1, 2, 3, 4, 5, 6];
const brl = (n: number, casas = 2) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas });
const nf = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

/**
 * Novo insumo em passos: tipo, material, marca, medida da embalagem, compra e estoque, revisão.
 * Cria o material e, se já houver o que dar entrada, registra a entrada pela RPC (o saldo não se
 * grava direto). O estoque cheio informado vira o máximo, e o mínimo é 15% dele: é o que o painel
 * cobra e o aviso de compra usa.
 */
export function NovoInsumoEmPassos({
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
  const [r, setR] = useState<RespostasDoInsumo>(RESPOSTAS_VAZIAS_DO_INSUMO);
  const [passo, setPasso] = useState<NumeroDoPasso>(1);
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    if (aberto) {
      setR(RESPOSTAS_VAZIAS_DO_INSUMO);
      setPasso(1);
    }
  }, [aberto]);

  const existentes = useQuery({
    queryKey: ["materiais-do-novo-insumo", canSeeFinancials],
    enabled: aberto,
    queryFn: async () => {
      const { data, error } = await fromFinancialView("materiais", canSeeFinancials)
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        nome: string;
        unidade: string;
        fornecedor: string | null;
        caracteristicas: string | null;
      }[];
    },
  });

  const fornecedores = useMemo(
    () =>
      [
        ...new Set(
          (existentes.data ?? []).map((m) => m.fornecedor?.trim()).filter(Boolean) as string[],
        ),
      ].sort(),
    [existentes.data],
  );

  const parecidos = useMemo(
    () =>
      r.tipo && r.nome.trim().length >= 3
        ? materiaisParecidos(
            { nome: r.nome, unidade: r.tipo.unidade, caracteristicas: "" },
            existentes.data ?? [],
          ).filter((p) => p.nivel !== "parecido")
        : [],
    [r.nome, r.tipo, existentes.data],
  );

  const indice = PASSOS.indexOf(passo);
  const ultimo = passo === 6;
  const pendencia = pendenciaDoPassoDoInsumo(passo, r);
  const custo = custoPorUnidade(r);
  const cheio = Number(r.estoqueCheio.replace(",", ".")) || 0;
  const minimo = estoqueMinimoDoCheio(cheio);
  const entrada = entradaInicial(r);
  const porEmbalagem = quantidadePorEmbalagem(r);
  const un = r.tipo?.unidade ?? "un";

  function escolherTipo(t: TipoDeInsumo) {
    setR({
      ...RESPOSTAS_VAZIAS_DO_INSUMO,
      tipo: t,
      quantidadeNaEmbalagem: t.quantidadePadrao ? String(t.quantidadePadrao) : "",
    });
    setPasso(2);
  }
  function escolherVariante(v: VarianteDeInsumo) {
    setR({ ...r, variante: v, nome: v.nome });
    setPasso(3);
  }

  async function criar() {
    if (!r.tipo) return;
    setCriando(true);
    try {
      const linha = materialDasRespostas(r);
      // O custo só vai para quem o vê: a coluna é protegida.
      const payload = canSeeFinancials
        ? linha
        : { ...linha, custo_unitario: null, custo_medio: null };
      const { data, error } = await (supabase as any)
        .from("materiais")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      if (entrada > 0) {
        const { error: erroEntrada } = await (supabase as any).rpc("registrar_entrada_material", {
          p_material_id: data.id,
          p_quantidade: entrada,
          p_custo_unitario: custo,
          p_fornecedor: linha.fornecedor,
          p_nota: null,
          p_validade: null,
          p_localizacao: linha.localizacao,
          p_observacao: "Entrada inicial pelo assistente de novo material",
        });
        if (erroEntrada) {
          toast.error(
            `O material foi criado, mas a entrada no estoque não entrou (${mensagemErro(erroEntrada)}). Use Entrada / saída.`,
          );
        }
      }
      toast.success(`${linha.nome} cadastrado`);
      registrarUso("novo-material", "concluiu");
      qc.invalidateQueries({ queryKey: ["materiais"] });
      qc.invalidateQueries({ queryKey: ["pendencias-do-sistema"] });
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
      titulo="Novo material em passos"
      passos={PASSOS_DO_INSUMO}
      atual={passo}
      onIr={(n) => setPasso(n as NumeroDoPasso)}
      pendencia={passo <= 2 ? null : pendencia}
      semAvancar={passo <= 2}
      rotuloCriar="Criar material"
      criando={criando}
      onCriar={criar}
      testId="novo-insumo-em-passos"
      tela="novo-material"
    >
      {passo === 1 && (
        <GradeDeCartoes rotulo="Tipo de material">
          {TIPOS_DE_INSUMO.map((t) => {
            const Icone = ICONES[t.icone] ?? Square;
            return (
              <CartaoDeEscolha
                key={t.chave}
                ativo={r.tipo?.chave === t.chave}
                titulo={t.titulo}
                detalhe={t.detalhe}
                icone={<Icone className="h-8 w-8 text-muted-foreground" />}
                onEscolher={() => escolherTipo(t)}
              />
            );
          })}
          <CartaoDeEscolha
            ativo={false}
            titulo="Outro"
            detalhe="cadastro completo, campo a campo"
            onEscolher={() => {
              onFechar();
              onAbrirCadastroCompleto();
            }}
          />
        </GradeDeCartoes>
      )}

      {passo === 2 && r.tipo && (
        <GradeDeCartoes rotulo={`Material: ${r.tipo.titulo}`}>
          {r.tipo.variantes.map((v) => (
            <CartaoDeEscolha
              key={v.chave}
              ativo={r.variante?.chave === v.chave}
              titulo={v.titulo}
              detalhe={v.detalhe}
              onEscolher={() => escolherVariante(v)}
            />
          ))}
        </GradeDeCartoes>
      )}

      {passo === 3 && (
        <div className="space-y-3">
          {existentes.isLoading ? (
            <Carregando linhas={1} />
          ) : (
            fornecedores.length > 0 && (
              <GradeDeCartoes rotulo="Fornecedor ou marca">
                {fornecedores.map((f) => (
                  <CartaoDeEscolha
                    key={f}
                    ativo={r.fornecedor === f}
                    titulo={f}
                    onEscolher={() => {
                      setR({ ...r, fornecedor: f });
                      setPasso(4);
                    }}
                  />
                ))}
              </GradeDeCartoes>
            )
          )}
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor="ni-marca">Marca ou fornecedor (opcional)</Label>
            <Input
              id="ni-marca"
              value={r.fornecedor}
              placeholder="Ex.: Avery, 3M, Distribuidora Norte"
              onChange={(e) => setR({ ...r, fornecedor: e.target.value })}
            />
          </div>
        </div>
      )}

      {passo === 4 && r.tipo && (
        <div className="space-y-4">
          {r.tipo.medida === "bobina" && (
            <>
              <div className="space-y-1.5">
                <Label>Largura da bobina</Label>
                <GradeDeCartoes rotulo="Largura da bobina">
                  {LARGURAS_DE_BOBINA_M.map((l) => (
                    <CartaoDeEscolha
                      key={l}
                      ativo={Number(r.largura.replace(",", ".")) === l}
                      titulo={`${nf(l)} m`}
                      className="min-h-14"
                      onEscolher={() => setR({ ...r, largura: String(l) })}
                    />
                  ))}
                </GradeDeCartoes>
                <Input
                  aria-label="Outra largura, em metros"
                  className="max-w-40"
                  inputMode="decimal"
                  placeholder="Outra, em m"
                  value={r.largura}
                  onChange={(e) => setR({ ...r, largura: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Comprimento da bobina</Label>
                <GradeDeCartoes rotulo="Comprimento da bobina">
                  {COMPRIMENTOS_DE_BOBINA_M.map((c) => (
                    <CartaoDeEscolha
                      key={c}
                      ativo={Number(r.comprimento.replace(",", ".")) === c}
                      titulo={`${c} m`}
                      className="min-h-14"
                      onEscolher={() => setR({ ...r, comprimento: String(c) })}
                    />
                  ))}
                </GradeDeCartoes>
                <Input
                  aria-label="Outro comprimento, em metros"
                  className="max-w-40"
                  inputMode="decimal"
                  placeholder="Outro, em m"
                  value={r.comprimento}
                  onChange={(e) => setR({ ...r, comprimento: e.target.value })}
                />
              </div>
            </>
          )}
          {r.tipo.medida === "chapa" && (
            <div className="space-y-1.5">
              <Label>Tamanho da chapa</Label>
              <GradeDeCartoes rotulo="Tamanho da chapa">
                {CHAPAS_COMUNS.map((c) => (
                  <CartaoDeEscolha
                    key={c.titulo}
                    ativo={
                      Number(r.largura.replace(",", ".")) === c.largura &&
                      Number(r.comprimento.replace(",", ".")) === c.altura
                    }
                    titulo={c.titulo}
                    detalhe={`${nf(c.largura * c.altura)} m²`}
                    onEscolher={() =>
                      setR({ ...r, largura: String(c.largura), comprimento: String(c.altura) })
                    }
                  />
                ))}
              </GradeDeCartoes>
            </div>
          )}
          {r.tipo.medida === "quantidade" && (
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="ni-qtd">
                Quantos {r.tipo.unidade} vêm em cada {r.tipo.embalagem}
              </Label>
              <Input
                id="ni-qtd"
                inputMode="decimal"
                value={r.quantidadeNaEmbalagem}
                onChange={(e) => setR({ ...r, quantidadeNaEmbalagem: e.target.value })}
              />
            </div>
          )}
          {porEmbalagem > 0 && (
            <p className="text-sm text-muted-foreground">
              Cada {r.tipo.embalagem} tem {nf(porEmbalagem)} {un}.
            </p>
          )}
        </div>
      )}

      {passo === 5 && r.tipo && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {canSeeFinancials && (
              <div className="space-y-1.5">
                <Label htmlFor="ni-preco">Quanto pagou pela {r.tipo.embalagem}</Label>
                <Input
                  id="ni-preco"
                  inputMode="decimal"
                  value={r.precoDaEmbalagem}
                  onChange={(e) => setR({ ...r, precoDaEmbalagem: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ni-cheio">Estoque cheio, em {un}</Label>
              <Input
                id="ni-cheio"
                inputMode="decimal"
                value={r.estoqueCheio}
                placeholder={porEmbalagem > 0 ? `Ex.: ${nf(porEmbalagem * 4)}` : ""}
                onChange={(e) => setR({ ...r, estoqueCheio: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ni-agora">
                {r.tipo.embalagem[0].toUpperCase() + r.tipo.embalagem.slice(1)}s que entram agora
              </Label>
              <Input
                id="ni-agora"
                inputMode="decimal"
                value={r.embalagensAgora}
                placeholder="0"
                onChange={(e) => setR({ ...r, embalagensAgora: e.target.value })}
              />
            </div>
          </div>
          {custo > 0 && (
            <p className="text-sm">
              Custo: {brl(custo, 4)} por {un}.
            </p>
          )}
          {cheio > 0 ? (
            <p className="text-sm text-muted-foreground">
              O sistema avisa para comprar quando o saldo chegar a {nf(minimo)} {un} (
              {FRACAO_DO_AVISO_DE_COMPRA * 100}% do estoque cheio).
            </p>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Sem o estoque cheio não há aviso de compra: o painel cobra esse número até alguém
              preencher.
            </p>
          )}
          {entrada > 0 && (
            <p className="text-sm text-muted-foreground">
              Entram {nf(entrada)} {un} no estoque ao criar.
            </p>
          )}
        </div>
      )}

      {passo === 6 && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ni-nome">Nome *</Label>
            <Input
              id="ni-nome"
              value={r.nome}
              onChange={(e) => setR({ ...r, nome: e.target.value })}
            />
          </div>
          {parecidos.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium">Já existe algo parecido no estoque:</p>
              <ul className="list-inside list-disc">
                {parecidos.map((p) => (
                  <li key={p.material.id}>{p.material.nome}</li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                Duplicar divide o estoque em dois. Se é o mesmo material, use o que já existe.
              </p>
            </div>
          )}
          <dl className="grid gap-x-4 gap-y-1 rounded-lg border p-3 text-sm sm:grid-cols-2">
            <Linha rotulo="Tipo" valor={`${r.tipo?.titulo} · ${r.variante?.titulo}`} />
            <Linha rotulo="Marca" valor={r.fornecedor.trim() || "não informada"} />
            <Linha
              rotulo="Embalagem"
              valor={porEmbalagem > 0 ? `${nf(porEmbalagem)} ${un}` : "—"}
            />
            <Linha rotulo="Custo" valor={custo > 0 ? `${brl(custo, 4)}/${un}` : "não informado"} />
            <Linha
              rotulo="Estoque cheio"
              valor={cheio > 0 ? `${nf(cheio)} ${un}` : "não definido"}
            />
            <Linha
              rotulo="Aviso de compra"
              valor={minimo > 0 ? `${nf(minimo)} ${un}` : "sem aviso"}
            />
            <Linha rotulo="Entra agora" valor={entrada > 0 ? `${nf(entrada)} ${un}` : "nada"} />
          </dl>
        </div>
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
