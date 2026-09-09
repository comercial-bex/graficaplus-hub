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
          <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            {o.empresa.nome}
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">
            Orçamento nº {o.numero}
          </h1>
          <p className="text-muted-foreground">{o.titulo}</p>
          <div className="flex flex-wrap gap-2 pt-2 text-xs text-muted-foreground">
            <Badge variant="secondary">Cliente: {o.cliente}</Badge>
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
                {i.artes.length > 0 && (
                  <div className="flex gap-2 flex-wrap">
                    {i.artes.map((a) => (
                      <a
                        key={a.url}
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block w-28 rounded-md border overflow-hidden"
                        title={a.nome}
                      >
                        <img
                          src={a.url}
                          alt={`Arte ${a.nome} do item ${i.descricao}`}
                          className="h-20 w-full object-contain bg-muted"
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
      </div>
    </div>
  );
}
