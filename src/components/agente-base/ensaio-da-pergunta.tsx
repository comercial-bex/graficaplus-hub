import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PainelDaBase } from "@/lib/api/agente-base.functions";
import { casamentosDaPergunta, separarOsOutros } from "@/domain/agente-base/casar";
import { ROTULO_DO_STATUS } from "@/domain/agente-base/fila";
import type { RamoDaBase } from "@/domain/agente-base/tipos";
import { CAMPO, SELETOR } from "@/components/triagem/comum";

/**
 * Área de ensaio: o dono digita uma pergunta e vê qual resposta APROVADA
 * serviria. O casamento é só por frase gatilho (nunca IA) e não envia nada a
 * ninguém: roda aqui, na função pura do domínio. Rascunho e arquivada aparecem
 * como "ainda não serve", para o dono entender por que uma pergunta ficaria sem
 * resposta.
 */
export function EnsaioDaPergunta({ painel }: { painel: PainelDaBase }) {
  const [pergunta, setPergunta] = useState("");
  const [ramo, setRamo] = useState<RamoDaBase>("cliente");
  const [produtoId, setProdutoId] = useState("");
  const produto = painel.produtos.find((p) => p.id === produtoId) ?? null;
  const achados = useMemo(
    () =>
      pergunta.trim()
        ? casamentosDaPergunta(pergunta, painel.respostas, {
            ramo,
            produtoId: produtoId || null,
            familia: produto?.familia ?? null,
          })
        : [],
    [pergunta, painel.respostas, ramo, produtoId, produto?.familia],
  );
  const { serve, perderamNoDesempate, aindaNaoServem } = separarOsOutros(achados);
  // o produto da conversa só pode ser um produto ativo: produto desativado não está em nenhuma conversa nova
  const produtosAtivos = painel.produtos.filter((p) => p.ativo);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Ensaio: que resposta serviria</CardTitle>
        <p className="text-base text-foreground">
          Escreva uma pergunta do jeito que o contato escreveria. A tela mostra qual resposta
          aprovada serviria. O casamento é só pelas frases que chamam cada resposta. Nada é enviado
          a ninguém.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_14rem]">
          <div className="space-y-1">
            <Label htmlFor="ensaio-pergunta" className="text-base font-semibold text-foreground">
              Pergunta do contato
            </Label>
            <Input
              id="ensaio-pergunta"
              className={CAMPO}
              placeholder="Escreva como o cliente escreveria"
              value={pergunta}
              maxLength={200}
              onChange={(e) => setPergunta(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ensaio-ramo" className="text-base text-foreground">
              Quem pergunta
            </Label>
            <select
              id="ensaio-ramo"
              className={SELETOR}
              value={ramo}
              onChange={(e) => setRamo(e.target.value as RamoDaBase)}
            >
              <option value="cliente">Cliente final</option>
              <option value="parceiro">Parceiro</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ensaio-produto" className="text-base text-foreground">
              Produto da conversa
            </Label>
            <select
              id="ensaio-produto"
              className={SELETOR}
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
            >
              <option value="">Nenhum em especial</option>
              {produtosAtivos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!pergunta.trim() ? null : serve ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted p-4" role="status">
            <p className="text-base font-semibold text-foreground">
              Serviria: {serve.resposta.pergunta}
            </p>
            <p className="text-base text-foreground">Casou pela frase: {serve.frase}.</p>
            <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground">
              {serve.resposta.texto_aprovado ?? serve.resposta.resposta}
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-warning bg-warning/15 p-4 text-base text-foreground" role="status">
            Nenhuma resposta aprovada serviria. A pergunta seguiria para a equipe responder.
          </p>
        )}

        {perderamNoDesempate.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">Aprovadas que também casam</h3>
            <ul className="space-y-2">
              {perderamNoDesempate.map((o) => (
                <li key={o.resposta.id} className="rounded-md border border-border p-3 text-base text-foreground">
                  <span className="font-semibold">{o.resposta.pergunta}</span>. Casou pela frase {o.frase}.
                  Também casa, mas outra resposta aprovada tem prioridade.
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {aindaNaoServem.length > 0 ? (
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">Também casam, mas ainda não servem</h3>
            <ul className="space-y-2">
              {aindaNaoServem.map((o) => (
                <li key={o.resposta.id} className="rounded-md border border-border p-3 text-base text-foreground">
                  <span className="font-semibold">{o.resposta.pergunta}</span>. Casou pela frase {o.frase}. Está
                  como {ROTULO_DO_STATUS[o.resposta.status].toLowerCase()}, então não serve até ser aprovada.
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
