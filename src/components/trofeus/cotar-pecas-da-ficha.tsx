import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Calculator, Info, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erros";
import { cotarFichaSobMedida, type CotacaoDoTrofeuComAval } from "@/lib/api/trofeus.functions";
import type { CotacaoPublicaDoTrofeu } from "@/domain/trofeus/cotacao";
import type { Decoracao } from "@/domain/trofeus/conta";
import type { CatalogoParaFicha } from "@/domain/trofeus/ficha-comparar";
import type { FichaLida } from "@/domain/trofeus/ficha-lida";
import { ROTULO_DA_DECORACAO } from "@/domain/trofeus/ficha";
import { materiaisCompativeis } from "@/domain/trofeus/sob-medida";
import {
  aoMudarAEspessura,
  linhasDaFicha,
  numeroDoCampo,
  pedidoDaTela,
  type LinhaDaTela,
} from "@/domain/trofeus/sob-medida-tela";

/**
 * COTAR AS PEÇAS DA FICHA (26/11/2026): depois de "Ler a ficha", a pessoa pode pedir o preço das peças que a ficha lista,
 * mesmo que nenhum modelo cadastrado as tenha (a placa de 6 mm, a base de 10 mm, a plaqueta de prata). Não exige estoque
 * nem material cadastrado: falta só o custo do m² de cada material. Peça sem material igual no cadastro leva um
 * substituto da MESMA espessura, e a resposta avisa que o preço dela é estimativa.
 *
 * O preço NUNCA é calculado aqui: vem de `cotarFichaSobMedida` (servidor), com a mesma conta do `cotarTrofeu`. Nada é
 * gravado: para levar o valor ao orçamento, lance-o como item livre ou use o modelo mais próximo na calculadora.
 */

const REAL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const reais = (n: number) => REAL.format(n);

type Resposta = CotacaoPublicaDoTrofeu | CotacaoDoTrofeuComAval;
const comCusto = (c: Resposta): c is CotacaoDoTrofeuComAval => "custoCheio" in c;

const DECORACOES: Decoracao[] = ["nenhuma", "vinil_laminado", "gravacao_laser"];

type Props = {
  ficha: FichaLida;
  catalogo: CatalogoParaFicha;
};

export function CotarAsPecasDaFicha({ ficha, catalogo }: Props) {
  const [linhas, setLinhas] = useState<LinhaDaTela[]>(() => linhasDaFicha(ficha, catalogo));
  const [altura, setAltura] = useState(() =>
    ficha.alturaCm != null ? String(Math.round(ficha.alturaCm * 10) / 10).replace(".", ",") : "",
  );
  const [quantidade, setQuantidade] = useState(() => String(ficha.quantidade ?? 1));
  const [urgente, setUrgente] = useState(ficha.urgente === true);

  const cotar = useMutation({
    mutationFn: async (): Promise<Resposta> => {
      const p = pedidoDaTela(linhas, altura, quantidade, urgente);
      if (!p.ok) throw new Error(p.problema);
      return cotarFichaSobMedida({ data: p.pedido });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  const pedido = pedidoDaTela(linhas, altura, quantidade, urgente);
  const resposta = cotar.data ?? null;

  /** Qualquer mudança nos campos apaga o preço antigo: o que está na tela nunca é de uma conta anterior. */
  function editar(fn: () => void) {
    cotar.reset();
    fn();
  }
  const mudarLinha = (chave: string, parte: Partial<LinhaDaTela>) =>
    editar(() => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...parte } : l))));

  if (linhas.length === 0) return null;

  return (
    <section
      className="space-y-3 rounded-lg border border-border p-3"
      aria-label="Cotar as peças da ficha"
      data-testid="cotar-pecas"
    >
      <header className="space-y-1">
        <h4 className="text-base font-semibold">Cotar as peças da ficha</h4>
        <p className="text-sm text-muted-foreground">
          Para troféu que nenhum modelo cobre. Não precisa ter a chapa em estoque: o que conta é o
          material ter custo no cadastro. Confira cada peça e o material de cada uma.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="space-y-1.5 text-sm font-medium" htmlFor="cotar-altura">
          Altura do troféu (cm)
          <Input
            id="cotar-altura"
            inputMode="decimal"
            className="min-h-11"
            value={altura}
            onChange={(ev) => editar(() => setAltura(ev.target.value))}
            data-testid="cotar-altura"
          />
        </label>
        <label className="space-y-1.5 text-sm font-medium" htmlFor="cotar-quantidade">
          Quantidade de troféus
          <Input
            id="cotar-quantidade"
            inputMode="numeric"
            className="min-h-11"
            value={quantidade}
            onChange={(ev) => editar(() => setQuantidade(ev.target.value))}
            data-testid="cotar-quantidade"
          />
        </label>
        <div className="flex items-end gap-2 pb-2">
          <Switch
            id="cotar-urgente"
            checked={urgente}
            onCheckedChange={(v) => editar(() => setUrgente(v))}
            aria-label="Troféu urgente"
          />
          <label htmlFor="cotar-urgente" className="text-sm font-medium">
            Urgente
          </label>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">Peças da ficha para cotar</caption>
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Peça
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Espessura (mm)
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Largura × altura (cm)
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Por troféu
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Decoração
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Forma do contorno
              </th>
              <th scope="col" className="py-1.5 font-medium">
                Material do cadastro
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const opcoes = materiaisCompativeis(
                numeroDoCampo(l.espessura),
                catalogo.materiais,
              ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
              const trocado =
                l.materialId !== "" &&
                l.materialId !== l.materialSugeridoId &&
                l.materialDaFicha != null &&
                l.materialDaFicha.trim() !== "";
              return (
                <tr
                  key={l.chave}
                  className="border-b border-border align-top last:border-0"
                  data-testid="cotar-peca"
                >
                  <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                    {l.nome}
                    {l.materialDaFicha && (
                      <span className="block text-sm font-normal text-muted-foreground">
                        Ficha: {l.materialDaFicha}
                      </span>
                    )}
                  </th>
                  <td className="py-1.5 pr-3">
                    <Input
                      inputMode="decimal"
                      className="min-h-11 w-20"
                      value={l.espessura}
                      aria-label={`Espessura da peça ${l.nome}, em milímetros`}
                      onChange={(ev) =>
                        editar(() =>
                          setLinhas((ls) =>
                            ls.map((x) =>
                              x.chave === l.chave
                                ? aoMudarAEspessura(x, ev.target.value, catalogo)
                                : x,
                            ),
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-1">
                      <Input
                        inputMode="decimal"
                        className="min-h-11 w-20"
                        value={l.largura}
                        aria-label={`Largura da peça ${l.nome}, em centímetros`}
                        onChange={(ev) => mudarLinha(l.chave, { largura: ev.target.value })}
                      />
                      <span aria-hidden="true">×</span>
                      <Input
                        inputMode="decimal"
                        className="min-h-11 w-20"
                        value={l.altura}
                        aria-label={`Altura da peça ${l.nome}, em centímetros`}
                        onChange={(ev) => mudarLinha(l.chave, { altura: ev.target.value })}
                      />
                    </div>
                  </td>
                  <td className="py-1.5 pr-3">
                    <Input
                      inputMode="numeric"
                      className="min-h-11 w-16"
                      value={l.quantidade}
                      aria-label={`Quantidade da peça ${l.nome} por troféu`}
                      onChange={(ev) => mudarLinha(l.chave, { quantidade: ev.target.value })}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <Select
                      value={l.decoracao}
                      onValueChange={(v) => mudarLinha(l.chave, { decoracao: v as Decoracao })}
                    >
                      <SelectTrigger
                        className="min-h-11 w-44"
                        aria-label={`Decoração da peça ${l.nome}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DECORACOES.map((d) => (
                          <SelectItem key={d} value={d}>
                            {ROTULO_DA_DECORACAO[d]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <Input
                      inputMode="decimal"
                      className="min-h-11 w-20"
                      value={l.fatorDeForma}
                      aria-label={`Forma do contorno da peça ${l.nome}`}
                      onChange={(ev) => mudarLinha(l.chave, { fatorDeForma: ev.target.value })}
                    />
                    <span className="block text-sm text-muted-foreground">1 = retângulo</span>
                  </td>
                  <td className="py-1.5">
                    {opcoes.length === 0 ? (
                      <p
                        className="flex items-start gap-1 text-sm"
                        data-testid="cotar-sem-material"
                      >
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>
                          Nenhuma chapa dessa espessura no cadastro. Cadastre o material (só nome,
                          espessura e custo do m²; não precisa de estoque) e leia a ficha de novo.
                        </span>
                      </p>
                    ) : (
                      <>
                        <Select
                          value={l.materialId || undefined}
                          onValueChange={(v) => mudarLinha(l.chave, { materialId: v })}
                        >
                          <SelectTrigger
                            className="min-h-11 w-64"
                            aria-label={`Material da peça ${l.nome}`}
                            data-testid="cotar-material"
                          >
                            <SelectValue placeholder="Escolha o material" />
                          </SelectTrigger>
                          <SelectContent>
                            {opcoes.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {trocado && (
                          <p
                            className="mt-1 flex items-start gap-1 text-sm"
                            data-testid="cotar-material-trocado"
                          >
                            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                            <span>
                              Cotada com este material no lugar do da ficha: o preço dela é
                              estimativa.
                            </span>
                          </p>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          className="min-h-11"
          disabled={!pedido.ok || cotar.isPending}
          onClick={() => cotar.mutate()}
          data-testid="cotar-pecas-cotar"
        >
          <Calculator className="mr-2 h-4 w-4" aria-hidden="true" />
          {cotar.isPending ? "Calculando…" : "Cotar estas peças"}
        </Button>
        {!pedido.ok && (
          <p className="text-sm text-muted-foreground" data-testid="cotar-pecas-falta">
            {pedido.problema}
          </p>
        )}
      </div>

      {cotar.isError && (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm text-destructive"
          data-testid="cotar-pecas-erro"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{" "}
          {mensagemErro(cotar.error)}
        </p>
      )}

      {resposta && (
        <div
          role="status"
          className="space-y-2 rounded-md border border-border bg-card p-3"
          data-testid="cotar-pecas-resultado"
        >
          <p className="text-base">
            Cada troféu:{" "}
            <strong data-testid="cotar-preco-unitario">{reais(resposta.precoUnitario)}</strong>
            {resposta.quantidade > 1 && (
              <>
                {" · "}
                {resposta.quantidade} troféus:{" "}
                <strong data-testid="cotar-preco-total">{reais(resposta.precoTotal)}</strong>
              </>
            )}
          </p>
          {resposta.avisos.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm" data-testid="cotar-pecas-avisos">
              {resposta.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          {comCusto(resposta) && (
            <dl
              className={cn(
                "grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-2 text-sm sm:grid-cols-4",
              )}
              data-testid="cotar-pecas-custo"
            >
              <div>
                <dt className="text-muted-foreground">Custo cheio</dt>
                <dd className="font-medium">{reais(resposta.custoCheio)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Custo de produção</dt>
                <dd className="font-medium">{reais(resposta.custoDeProducao)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Multiplicador</dt>
                <dd className="font-medium">×{String(resposta.multiplicador).replace(".", ",")}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Margem líquida</dt>
                <dd className="font-medium">
                  {String(resposta.margemLiquidaPct).replace(".", ",")}%
                </dd>
              </div>
            </dl>
          )}
          <p className="text-sm text-muted-foreground">
            Nada foi gravado. Para levar este valor ao orçamento, lance-o como item livre, ou use o
            modelo mais próximo na calculadora.
          </p>
        </div>
      )}
    </section>
  );
}
