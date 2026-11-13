import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erros";
import { cn } from "@/lib/utils";
import { ConfirmarAcao } from "@/components/bex/ConfirmarAcao";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  desligarTudoDaTriagem,
  mudarDegrauDaTriagem,
  salvarConfigDaTriagem,
  type ConfigParaSalvar,
  type PainelDaTriagem,
} from "@/lib/api/whatsapp-triagem.functions";
import {
  avisoDeConfirmacao,
  degrausParaDescer,
  DEGRAUS,
  EXPLICACAO_DO_DEGRAU,
  mandaMensagemDeVerdade,
  podeSubir,
  proximoDegrau,
  ROTULO_DO_DEGRAU,
  textoDoBotaoDeSubir,
  type Degrau,
} from "@/domain/whatsapp/triagem/escada";
import {
  digitosDoNumero,
  diaEmBelem,
  motivoDeDesligar,
  numeroDeTesteValido,
  numeroEmTexto,
  statusEmTexto,
} from "@/domain/whatsapp/triagem/tela";
import { Aviso, BOTAO, CAMPO, ErroDeGravacao } from "./comum";

/**
 * O painel de ligar do robô de boas-vindas: o estado, o botão grande que sobe
 * um degrau por vez, os degraus de descida, o botão vermelho Desligar tudo, a
 * porcentagem, os números de teste e o link de parceiro. Nada aqui manda
 * mensagem: cada botão chama uma função do servidor que confere a permissão.
 */
export function PainelDeLiga({
  painel,
  aoMudar,
}: {
  painel: PainelDaTriagem;
  aoMudar: () => void;
}) {
  const { config, podeLigar, podeEditar } = painel;
  const atual = config.estado as Degrau;
  const subir = podeSubir({
    atual,
    percentual: config.percentual,
    numerosDeTeste: config.numeros_teste ?? [],
    linkDeParceiro: config.link_parceiro,
  });
  const proximo = proximoDegrau(atual);
  const [erro, setErro] = useState<string | null>(null);

  const mudar = useServerFn(mudarDegrauDaTriagem);
  const desligar = useServerFn(desligarTudoDaTriagem);

  const mudarDegrau = useMutation({
    mutationFn: (para: Degrau) => mudar({ data: { para } }),
    onSuccess: (r) => {
      setErro(null);
      toast.success(
        `Agora está em ${ROTULO_DO_DEGRAU[r.estado as Degrau]?.toLowerCase() ?? r.estado}.`,
      );
      aoMudar();
    },
    onError: (e) => {
      const m = mensagemErro(e, "Não foi possível mudar o degrau.");
      setErro(m);
      toast.error(m);
    },
  });

  const desligarTudo = useMutation({
    mutationFn: () => desligar({ data: {} }),
    onSuccess: (r) => {
      setErro(null);
      toast.success(
        `Desligado. ${r.pausadas} conversa${r.pausadas === 1 ? "" : "s"} parada${r.pausadas === 1 ? "" : "s"} e ${r.canceladasNaFila} mensage${r.canceladasNaFila === 1 ? "m" : "ns"} cancelada${r.canceladasNaFila === 1 ? "" : "s"}.`,
      );
      aoMudar();
    },
    onError: (e) => {
      const m = mensagemErro(e, "Não foi possível desligar. Tente de novo agora.");
      setErro(m);
      toast.error(m);
    },
  });

  const confirmacao = proximo ? avisoDeConfirmacao(proximo, config.percentual) : null;
  const botaoDeSubir = (
    <Button
      type="button"
      size="lg"
      className="min-h-14 w-full text-lg font-semibold sm:w-auto sm:min-w-72"
      disabled={!podeLigar || !subir.pode || mudarDegrau.isPending}
      onClick={confirmacao ? undefined : () => proximo && mudarDegrau.mutate(proximo)}
    >
      {mudarDegrau.isPending ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : null}
      {textoDoBotaoDeSubir(atual)}
    </Button>
  );

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-xl">Ligar e desligar</CardTitle>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-4 text-lg font-bold text-foreground",
              atual === "desligada" ? "border-border bg-muted" : "border-link bg-link/10",
            )}
          >
            Agora: {ROTULO_DO_DEGRAU[atual]}
          </span>
          {atual !== "desligada" && config.percentual > 0 && atual === "parcial" ? (
            <span className="text-lg font-semibold text-foreground">
              {config.percentual} de cada 100 contatos novos
            </span>
          ) : null}
        </div>
        <p className="text-base text-foreground">{EXPLICACAO_DO_DEGRAU[atual]}</p>
        {atual === "desligada" ? (
          <p className="text-base text-muted-foreground">
            {motivoDeDesligar(config.desligada_por)}
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-5">
        <ol className="grid gap-2 sm:grid-cols-5" aria-label="Os cinco degraus">
          {DEGRAUS.map((d, i) => (
            <li
              key={d}
              aria-current={d === atual ? "step" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-md border px-3 text-base text-foreground",
                d === atual ? "border-link bg-link/10 font-bold" : "border-border bg-card",
              )}
            >
              <span className="font-semibold">{i + 1}.</span> {ROTULO_DO_DEGRAU[d]}
            </li>
          ))}
        </ol>

        {!podeLigar ? (
          <Aviso tom="atencao">
            Só quem tem a permissão de gerenciar o WhatsApp liga, sobe e desce o robô. Você pode editar os
            textos e pode apertar Desligar tudo.
          </Aviso>
        ) : null}

        <div className="space-y-3">
          {proximo && !subir.pode ? (
            <p className="text-base font-medium text-foreground">{subir.motivo}</p>
          ) : null}
          {subir.pode && subir.avisos.length > 0
            ? subir.avisos.map((a) => (
                <p key={a} className="text-base font-medium text-foreground">
                  {a}
                </p>
              ))
            : null}
          <div className="flex flex-wrap items-center gap-3">
            {confirmacao && proximo ? (
              <ConfirmarAcao
                titulo={`Subir para ${ROTULO_DO_DEGRAU[proximo].toLowerCase()}?`}
                descricao={`${confirmacao} Você pode descer ou desligar tudo a qualquer hora.`}
                rotuloConfirmar="Sim, subir"
                grande
                aoConfirmar={() => mudarDegrau.mutate(proximo)}
              >
                {botaoDeSubir}
              </ConfirmarAcao>
            ) : (
              botaoDeSubir
            )}

            {degrausParaDescer(atual).map((d) => (
              <Button
                key={d}
                type="button"
                variant="outline"
                className={BOTAO}
                disabled={!podeLigar || mudarDegrau.isPending}
                onClick={() => mudarDegrau.mutate(d)}
              >
                Descer para {ROTULO_DO_DEGRAU[d].toLowerCase()}
              </Button>
            ))}

            <ConfirmarAcao
              titulo="Desligar tudo agora?"
              descricao="O robô para na hora. As conversas abertas ficam só com a equipe e as mensagens que ainda não saíram são canceladas. Você pode ligar de novo depois, começando pelo ensaio."
              rotuloConfirmar="Sim, desligar tudo"
              destrutivo
              grande
              aoConfirmar={() => desligarTudo.mutate()}
            >
              <Button
                type="button"
                variant="destructive"
                size="lg"
                className="min-h-14 text-lg font-bold"
                disabled={atual === "desligada" || desligarTudo.isPending}
              >
                {desligarTudo.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Power className="h-5 w-5" aria-hidden="true" />
                )}
                Desligar tudo
              </Button>
            </ConfirmarAcao>
          </div>
          <ErroDeGravacao mensagem={erro} />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <BlocoDaPorcentagem painel={painel} aoMudar={aoMudar} />
          <BlocoDosNumerosDeTeste painel={painel} aoMudar={aoMudar} />
        </div>

        <BlocoDoLink painel={painel} aoMudar={aoMudar} podeEditar={podeEditar} />
        <Resumo painel={painel} />
        {mandaMensagemDeVerdade(atual) ? (
          <Aviso>
            O robô está respondendo de verdade neste degrau. Leia as conversas na caixa de WhatsApp
            e desligue se alguma resposta sair estranha.
          </Aviso>
        ) : null}
      </CardContent>
    </Card>
  );
}

function useGravarConfig(aoMudar: () => void) {
  const gravar = useServerFn(salvarConfigDaTriagem);
  return useMutation({
    mutationFn: (data: ConfigParaSalvar) => gravar({ data }),
    onSuccess: () => aoMudar(),
  });
}

function BlocoDaPorcentagem({ painel, aoMudar }: { painel: PainelDaTriagem; aoMudar: () => void }) {
  const [valor, setValor] = useState(String(painel.config.percentual));
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useGravarConfig(aoMudar);
  const n = Number(valor);
  const valido = valor.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 100;
  return (
    <section className="space-y-2 rounded-lg border border-border p-4">
      <Label htmlFor="percentual-triagem" className="text-base font-semibold text-foreground">
        Porcentagem dos contatos novos no degrau parcial
      </Label>
      <p className="text-base text-muted-foreground">
        De cada 100 contatos novos, quantos recebem o robô. O mesmo contato cai sempre do mesmo
        lado.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="percentual-triagem"
          inputMode="numeric"
          className={cn(CAMPO, "w-28")}
          value={valor}
          disabled={!painel.podeLigar}
          onChange={(e) => setValor(e.target.value.replace(/\D/g, "").slice(0, 3))}
        />
        <Button
          type="button"
          className={BOTAO}
          disabled={
            !painel.podeLigar || !valido || n === painel.config.percentual || gravar.isPending
          }
          onClick={() => {
            setErro(null);
            gravar.mutate(
              { percentual: n },
              {
                onSuccess: () => toast.success("Porcentagem salva."),
                onError: (e) => setErro(mensagemErro(e, "Não foi possível salvar a porcentagem.")),
              },
            );
          }}
        >
          Salvar porcentagem
        </Button>
      </div>
      {!valido ? <p className="text-base text-foreground">Escreva um número de 0 a 100.</p> : null}
      <ErroDeGravacao mensagem={erro} />
    </section>
  );
}

function BlocoDosNumerosDeTeste({
  painel,
  aoMudar,
}: {
  painel: PainelDaTriagem;
  aoMudar: () => void;
}) {
  const lista = painel.config.numeros_teste ?? [];
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useGravarConfig(aoMudar);

  function gravarLista(numeros: string[], aviso: string) {
    setErro(null);
    gravar.mutate(
      { numerosTeste: numeros },
      {
        onSuccess: () => {
          toast.success(aviso);
          setNovo("");
        },
        onError: (e) => setErro(mensagemErro(e, "Não foi possível salvar os números de teste.")),
      },
    );
  }

  const digitos = digitosDoNumero(novo);
  const valido = numeroDeTesteValido(novo);
  const repetido = lista.some(
    (n) => digitosDoNumero(n).endsWith(digitos.slice(-11)) && digitos.length >= 10,
  );

  return (
    <section className="space-y-2 rounded-lg border border-border p-4">
      <Label htmlFor="numero-de-teste" className="text-base font-semibold text-foreground">
        Números de teste
      </Label>
      <p className="text-base text-muted-foreground">
        Nos degraus teste e parcial, estes números sempre recebem o robô. Ponha o seu e o de um
        colega.
      </p>
      {lista.length === 0 ? (
        <p className="text-base text-foreground">Nenhum número cadastrado ainda.</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((n) => (
            <li
              key={n}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3"
            >
              <span className="text-base font-medium text-foreground">{numeroEmTexto(n)}</span>
              <Button
                type="button"
                variant="outline"
                className={BOTAO}
                disabled={!painel.podeLigar || gravar.isPending}
                aria-label={`Tirar o número ${numeroEmTexto(n)}`}
                onClick={() =>
                  gravarLista(
                    lista.filter((x) => x !== n),
                    "Número tirado.",
                  )
                }
              >
                <Trash2 className="h-5 w-5" aria-hidden="true" /> Tirar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="numero-de-teste"
          inputMode="tel"
          placeholder="96 99111-2233"
          className={cn(CAMPO, "w-52")}
          value={novo}
          disabled={!painel.podeLigar}
          onChange={(e) => setNovo(e.target.value.slice(0, 20))}
        />
        <Button
          type="button"
          className={BOTAO}
          disabled={!painel.podeLigar || !valido || repetido || gravar.isPending}
          onClick={() => gravarLista([...lista, digitos], "Número de teste salvo.")}
        >
          <Plus className="h-5 w-5" aria-hidden="true" /> Juntar número
        </Button>
      </div>
      {novo.trim() !== "" && !valido ? (
        <p className="text-base text-foreground">
          Escreva o celular com DDD, por exemplo 96 99111-2233.
        </p>
      ) : null}
      {repetido ? <p className="text-base text-foreground">Esse número já está na lista.</p> : null}
      <ErroDeGravacao mensagem={erro} />
    </section>
  );
}

function BlocoDoLink({
  painel,
  aoMudar,
  podeEditar,
}: {
  painel: PainelDaTriagem;
  aoMudar: () => void;
  podeEditar: boolean;
}) {
  const [valor, setValor] = useState(painel.config.link_parceiro ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const gravar = useGravarConfig(aoMudar);
  const novo = valor.trim();
  const valido = novo === "" || /^https:\/\/\S+$/.test(novo);
  return (
    <section className="space-y-2 rounded-lg border border-border p-4">
      <Label htmlFor="link-de-parceiro" className="text-base font-semibold text-foreground">
        Link de cadastro de parceiro
      </Label>
      <p className="text-base text-muted-foreground">
        É o único link que o robô manda, e só para quem pede para ser parceiro. Antes de ligar,
        confira que a página abre sem entrar no sistema e não mostra valor nem tabela.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="link-de-parceiro"
          className={cn(CAMPO, "min-w-0 flex-1 sm:min-w-80")}
          placeholder="https://"
          value={valor}
          disabled={!podeEditar}
          onChange={(e) => setValor(e.target.value.slice(0, 300))}
        />
        <Button
          type="button"
          className={BOTAO}
          disabled={
            !podeEditar ||
            !valido ||
            novo === (painel.config.link_parceiro ?? "") ||
            gravar.isPending
          }
          onClick={() => {
            setErro(null);
            gravar.mutate(
              { linkParceiro: novo === "" ? null : novo },
              {
                onSuccess: () => toast.success("Link salvo."),
                onError: (e) => setErro(mensagemErro(e, "Não foi possível salvar o link.")),
              },
            );
          }}
        >
          Salvar link
        </Button>
      </div>
      {!valido ? (
        <p className="text-base text-foreground">
          O link precisa começar com https:// e não ter espaços.
        </p>
      ) : null}
      <ErroDeGravacao mensagem={erro} />
    </section>
  );
}

function Resumo({ painel }: { painel: PainelDaTriagem }) {
  const { contagens, config } = painel;
  const status = Object.entries(contagens.porStatus).sort((a, b) => b[1] - a[1]);
  return (
    <section className="space-y-2 rounded-lg border border-border p-4">
      <h3 className="text-base font-semibold text-foreground">
        O que aconteceu nos últimos 7 dias
      </h3>
      {contagens.triagensEm7Dias === 0 ? (
        <p className="text-base text-foreground">Nenhuma conversa passou pelo robô ainda.</p>
      ) : (
        <p className="text-base text-foreground">
          {contagens.triagensEm7Dias} conversa{contagens.triagensEm7Dias === 1 ? "" : "s"}.{" "}
          {status.map(([s, n]) => `${statusEmTexto(s)}: ${n}`).join(". ")}.
        </p>
      )}
      <p className="text-base text-foreground">
        Erros nas últimas 24 horas: {contagens.errosEm24h}. Textos barrados nas últimas 24 horas:{" "}
        {contagens.textosBarradosEm24h}.
      </p>
      <p className="text-base text-muted-foreground">
        {config.vale_a_partir_de
          ? `Só vale para conversas que começaram depois de ${diaEmBelem(config.vale_a_partir_de)}. As conversas antigas nunca entram.`
          : "A data de início ainda não existe. Ela é gravada na primeira vez que o robô sai do desligado, e as conversas antigas nunca entram."}
      </p>
    </section>
  );
}
