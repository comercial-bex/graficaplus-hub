import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, MessageSquare, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { mensagemErro } from "@/lib/erros";
import { EnviarComprovanteDoCliente } from "@/components/pagamento/enviar-comprovante-do-cliente";
import { LOGO_FUNDO_CLARO } from "@/lib/marca";
import {
  obterOrcamentoPublico,
  responderOrcamentoPublico,
} from "@/lib/api/orcamento-publico.functions";

export const Route = createFileRoute("/orcamento-publico/$token")({
  head: () => ({
    meta: [
      { title: "Aprovação de orçamento — BEX PRINT" },
      {
        name: "description",
        content:
          "Confira os itens, as artes e o valor do seu orçamento e aprove online, sem precisar responder e-mail.",
      },
      { property: "og:title", content: "Aprovação de orçamento — BEX PRINT" },
      {
        property: "og:description",
        content: "Confira os itens, as artes e o valor do seu orçamento e aprove online.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OrcamentoPublicoPage,
});

const real = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (v?: string | null) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
const m2 = (v: number) => `${v.toFixed(3).replace(".", ",")}m²`;

/**
 * A cor da barra de cada cartão de arte, em rodízio pelas cores da logo — o
 * mesmo rodízio do bloco LAYOUT do PDF, para o link e o papel serem o mesmo
 * documento aos olhos do cliente.
 */
const CORES_DOS_CARTOES = ["var(--bex-magenta)", "var(--bex-lime)", "var(--bex-cyan)"];
const corDoCartao = (indice: number) => CORES_DOS_CARTOES[indice % CORES_DOS_CARTOES.length];

function OrcamentoPublicoPage() {
  const { token } = Route.useParams();
  const [nome, setNome] = useState("");
  const [observacao, setObservacao] = useState("");

  const consulta = useQuery({
    queryKey: ["orcamento-publico", token],
    queryFn: () => obterOrcamentoPublico({ data: { token } }),
    retry: false,
  });

  const responder = useMutation({
    mutationFn: (decisao: "aprovado" | "ajuste") =>
      responderOrcamentoPublico({ data: { token, decisao, nome, observacao } }),
    onSuccess: (r) => {
      toast.success(
        r.status === "aprovado"
          ? "Orçamento aprovado. Obrigado!"
          : "Pedido de ajuste enviado para a equipe.",
      );
      void consulta.refetch();
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível registrar sua resposta")),
  });

  if (consulta.isLoading) {
    return (
      <div className="min-h-screen grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (consulta.isError || !consulta.data) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl font-bold mb-2">Link inválido</h1>
          <p className="text-muted-foreground">
            Este link de orçamento não existe mais. Fale com a equipe para receber um novo.
          </p>
        </div>
      </div>
    );
  }

  const o = consulta.data;
  const jaRespondido = o.status === "aprovado" || o.status === "convertido";

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl p-4 md:p-8 space-y-6">
        <header className="space-y-1">
          {/* A logo oficial é a de fundo branco (letras pretas): vai numa placa
              branca de propósito — o celular do cliente pode estar no tema
              escuro, e nele as letras sumiriam. */}
          <div className="mb-3 inline-flex rounded-lg bg-white px-3 py-2 ring-1 ring-black/5">
            <img
              src={LOGO_FUNDO_CLARO}
              alt={o.empresa.nome || "Bex Print"}
              width={1165}
              height={533}
              className="h-9 w-auto md:h-11"
            />
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">
            Orçamento nº {o.numero}
          </h1>
          <p className="text-muted-foreground">{o.titulo}</p>
          <div className="flex flex-wrap gap-2 pt-2 text-xs text-muted-foreground">
            {/* Orçamento de contato avulso não tem cliente: a etiqueta vazia ("Cliente:") saía assim. */}
            {o.cliente ? <Badge variant="secondary">Cliente: {o.cliente}</Badge> : null}
            <Badge variant="secondary">Emissão: {dataBr(o.emissao)}</Badge>
            <Badge variant="secondary">Válido até: {dataBr(o.validade)}</Badge>
            <Badge variant="secondary">Entrega: {dataBr(o.entrega)}</Badge>
          </div>
        </header>

        <Card>
          <CardContent className="p-4 space-y-4">
            {o.itens.map((i, idx) => (
              <div key={idx} className="border-b last:border-0 pb-4 last:pb-0 space-y-2">
                <div className="flex justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {idx + 1}. {i.descricao}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {i.quantidade} {i.unidade ?? "un"}
                      {i.largura && i.altura
                        ? ` · ${i.largura.toFixed(3).replace(".", ",")}m x ${i.altura
                            .toFixed(3)
                            .replace(".", ",")}m = ${m2(Number(i.area_total ?? 0))}`
                        : ""}
                      {i.acabamento ? ` · ${i.acabamento}` : ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono">{real(i.valor_total)}</div>
                    <div className="text-xs text-muted-foreground">
                      {real(i.valor_unitario)} un.
                    </div>
                  </div>
                </div>
                {/* As artes em cartões grandes, como no PDF: a barra com o número
                    e o nome do item, a arte inteira embaixo (sempre sobre
                    branco, que é a folha — o tema escuro do celular não entra
                    no layout). O clique abre o arquivo original. */}
                {i.artes.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {i.artes.map((a, k) => (
                      <a
                        key={a.url}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg border bg-white ring-1 ring-black/5"
                      >
                        <div
                          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-white"
                          style={{ backgroundColor: corDoCartao(idx) }}
                        >
                          <span
                            className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-[11px]"
                            style={{ color: corDoCartao(idx) }}
                          >
                            {idx + 1}
                          </span>
                          <span className="truncate">{i.descricao}</span>
                          {i.artes.length > 1 && (
                            <span className="ml-auto shrink-0 font-normal opacity-90">
                              {k + 1}/{i.artes.length}
                            </span>
                          )}
                        </div>
                        <img
                          src={a.url}
                          alt={`Arte ${a.nome} do item ${i.descricao}`}
                          className="h-52 w-full bg-white object-contain p-2"
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="flex justify-end gap-6 pt-2 text-sm">
              {o.soma_area && (
                <span className="text-muted-foreground">Área total: {m2(o.soma_area)}</span>
              )}
              {o.desconto > 0 && (
                <span className="text-muted-foreground">Desconto: {real(o.desconto)}</span>
              )}
              <span className="text-lg font-black">{real(o.total)}</span>
            </div>
          </CardContent>
        </Card>

        {jaRespondido ? (
          <Card>
            <CardContent className="p-6 flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-[color:var(--bex-lime,green)]" />
              <div>
                <div className="font-medium">Orçamento aprovado</div>
                <div className="text-sm text-muted-foreground">
                  {o.aprovado_por_nome ? `Por ${o.aprovado_por_nome} · ` : ""}
                  {dataBr(o.aprovado_em)}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nome">Seu nome completo *</Label>
                <Input
                  id="nome"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Quem está aprovando"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="obs">Observação (opcional)</Label>
                <Textarea
                  id="obs"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Ex.: trocar a cor do fundo, alterar o telefone da arte…"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => responder.mutate("aprovado")}
                  disabled={responder.isPending || nome.trim().length < 3}
                >
                  <Check className="h-4 w-4 mr-1" /> Aprovar orçamento
                </Button>
                <Button
                  variant="outline"
                  onClick={() => responder.mutate("ajuste")}
                  disabled={responder.isPending || nome.trim().length < 3}
                >
                  <MessageSquare className="h-4 w-4 mr-1" /> Solicitar ajuste
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Ao aprovar, registramos seu nome, a data e a origem do acesso para valer como
                autorização de produção.
              </p>
            </CardContent>
          </Card>
        )}

        {jaRespondido && <EnviarComprovanteDoCliente token={token} />}
      </div>
    </div>
  );
}
