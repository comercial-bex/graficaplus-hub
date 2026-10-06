/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, KeyRound, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import {
  situacaoDaTv,
  textoDaSituacao,
  type DispositivoDeTv,
  type ListaDeTvs,
} from "@/domain/tv/pareamento";
import {
  PIN_MAXIMO,
  mensagemDoDefinirPin,
  pinBemFormado,
  pinObvio,
  type RespostaDoDefinirPin,
} from "@/domain/tv/pin";

/**
 * /telas — as TVs de parede: o PIN, ver se estão no ar, revogar.
 *
 * A TV da Oficina não tem login. Desde 06/10/2026 ela entra SÓ pelo PIN
 * (decisão do dono, "só PIN mesmo"): quem está na frente dela digita o PIN e
 * a TV ganha um crachá próprio. O pareamento por código, com aprovação aqui,
 * saiu — as TVs que já tinham entrado por ele continuam com o crachá delas até
 * alguém revogar, e aparecem na lista sem o selo "pelo PIN".
 *
 * O QUE ESTA TELA NÃO FAZ
 *   - Não mostra token nem hash: as funções do banco não devolvem nenhum dos
 *     dois. O crachá vai direto do servidor para a TV, uma vez.
 *   - Não finge lista vazia. Se a consulta cai, aparece o erro e o botão de
 *     tentar de novo — "nenhuma TV" só é dito quando o banco disse.
 *
 * O PIN DA TV
 *   O PIN fica no banco como hash: esta tela nunca o mostra, só troca ou
 *   desliga (`tv_definir_pin`). Trocar ou desligar desconecta as TVs que
 *   entraram pelo PIN — se o PIN vazou, é isso que corta quem entrou com ele.
 *   Desligado, nenhuma TV nova consegue entrar: a TV mostra "entrada
 *   desligada" e espera o PIN ser ligado de novo.
 *
 * A guarda de verdade está no banco (`tv_*` conferem admin/gestor a cada
 * chamada). A conferência de papel daqui só evita mostrar um formulário que o
 * banco recusaria.
 */

const CHAVE_DA_LISTA = ["tv-dispositivos"] as const;

/** A lista se atualiza sozinha a cada minuto: é o ritmo em que a TV lê o painel. */
const ROTINA_MS = 60_000;

export const Route = createFileRoute("/_authenticated/telas")({
  head: () => ({ meta: [{ title: "TVs da oficina — BEX PRINT OS" }] }),
  component: TelasPage,
});

function dataHora(iso: string | null): string {
  if (!iso) return "—";
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return "—";
  return quando.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Belem",
  });
}

function TelasPage() {
  const { hasAnyRole } = useAuth();
  const podeGerir = hasAnyRole(["admin", "gestor"]);
  const qc = useQueryClient();

  const [aRevogar, setARevogar] = useState<DispositivoDeTv | null>(null);
  const [novoPin, setNovoPin] = useState("");
  const [erroDoPin, setErroDoPin] = useState<string | null>(null);
  const [confirmarPin, setConfirmarPin] = useState<"salvar" | "desligar" | null>(null);

  const lista = useQuery({
    queryKey: CHAVE_DA_LISTA,
    enabled: podeGerir,
    queryFn: async (): Promise<ListaDeTvs> => {
      const { data, error } = await (supabase.rpc as any)("tv_listar_dispositivos");
      if (error) throw error;
      // Resposta sem a lista não é "nenhuma TV": é resposta quebrada.
      if (!data || !Array.isArray(data.dispositivos)) {
        throw new Error("O banco respondeu sem a lista de TVs.");
      }
      return data as ListaDeTvs;
    },
    refetchInterval: ROTINA_MS,
  });

  const revogar = useMutation({
    mutationFn: async (tv: DispositivoDeTv) => {
      const { data, error } = await (supabase.rpc as any)("tv_revogar_dispositivo", {
        p_id: tv.id,
      });
      if (error) throw error;
      if (!data || data.ok !== true) {
        throw new Error("Esta TV não foi encontrada. Atualize a lista e tente de novo.");
      }
      return tv;
    },
    onSuccess: (tv) => {
      toast.success(`${tv.nome} revogada. Na próxima leitura ela volta para o teclado do PIN.`);
      setARevogar(null);
      void qc.invalidateQueries({ queryKey: CHAVE_DA_LISTA });
    },
    onError: (e: unknown) => {
      toast.error(mensagemErro(e));
      setARevogar(null);
      void qc.invalidateQueries({ queryKey: CHAVE_DA_LISTA });
    },
  });

  const definirPin = useMutation({
    mutationFn: async (pin: string): Promise<RespostaDoDefinirPin> => {
      const { data, error } = await (supabase.rpc as any)("tv_definir_pin", { p_pin: pin });
      if (error) throw error;
      if (!data || typeof data.ok !== "boolean") {
        throw new Error("O banco respondeu sem dizer se o PIN foi salvo.");
      }
      return data as RespostaDoDefinirPin;
    },
    onSuccess: (resposta) => {
      setConfirmarPin(null);
      if (!resposta.ok) {
        setErroDoPin("O PIN tem de ter de 4 a 8 números, sem letras nem espaços.");
        return;
      }
      setErroDoPin(null);
      setNovoPin("");
      toast.success(mensagemDoDefinirPin(resposta));
      void qc.invalidateQueries({ queryKey: CHAVE_DA_LISTA });
    },
    onError: (e: unknown) => {
      setConfirmarPin(null);
      setErroDoPin(mensagemErro(e));
    },
  });

  if (!podeGerir) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-16 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">TVs da oficina</h1>
        <p className="text-muted-foreground">
          Só administrador ou gestor troca o PIN e revoga TV. Para ligar uma TV nova, digite o PIN
          nela — se não souber o PIN, peça a um dos dois.
        </p>
      </div>
    );
  }

  // "Há X" contra o relógio do banco, não o do navegador: celular com hora
  // errada chamaria de parada uma TV que está no ar.
  const agora = lista.data ? new Date(lista.data.agora) : new Date();
  const tvs = lista.data?.dispositivos ?? [];
  const ativas = tvs.filter((tv) => !tv.revogado_em);
  const revogadas = tvs.filter((tv) => tv.revogado_em);
  const pin = lista.data?.pin ?? null;
  const errosDePin = lista.data?.pin_erros_15min ?? 0;
  const tvsPeloPin = ativas.filter((tv) => tv.entrada === "pin").length;
  const pinPronto = pinBemFormado(novoPin);

  // Trocar ou desligar com TV conectada pelo PIN pede confirmação: elas caem.
  const pedirParaSalvarPin = () => {
    if (!pinPronto || definirPin.isPending) return;
    if (pin?.ligado && tvsPeloPin > 0) setConfirmarPin("salvar");
    else definirPin.mutate(novoPin);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">TVs da oficina</h1>
        <p className="text-muted-foreground">
          As telas de parede que mostram as máquinas. A TV entra só pelo PIN: aqui você define o
          PIN, vê se cada TV está no ar e corta o acesso de uma que saiu da oficina.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            PIN da TV
          </CardTitle>
          <CardDescription>
            Na TV, quem digita o PIN certo libera o painel das máquinas naquela tela, sem precisar
            de celular. O PIN fica guardado cifrado: nem aqui dá para lê-lo de volta, só trocar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lista.isError ? null : lista.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Conferindo o PIN…
            </div>
          ) : pin?.ligado ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>Ligado · {pin.digitos} números</Badge>
              <span className="text-muted-foreground">
                definido em {dataHora(pin.definido_em)}
                {pin.definido_por ? ` por ${pin.definido_por}` : ""}
                {tvsPeloPin > 0
                  ? ` · ${tvsPeloPin === 1 ? "1 TV entrou" : `${tvsPeloPin} TVs entraram`} por ele`
                  : ""}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">Desligado</Badge>
              <span className="text-muted-foreground">
                Nenhuma TV nova consegue entrar enquanto o PIN estiver desligado.
              </span>
            </div>
          )}

          {errosDePin >= 3 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{errosDePin} PINs errados nos últimos 15 minutos</AlertTitle>
              <AlertDescription>
                Depois de 5 erros a TV espera 15 minutos para aceitar de novo. Se não foi alguém da
                oficina errando, troque o PIN — quem estiver chutando perde o que já tentou.
              </AlertDescription>
            </Alert>
          )}

          <form
            className="grid gap-4 md:grid-cols-[240px_auto_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              pedirParaSalvarPin();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="tv-pin">{pin?.ligado ? "PIN novo" : "Ligar com o PIN"}</Label>
              <Input
                id="tv-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={novoPin}
                onChange={(e) => {
                  setNovoPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAXIMO));
                  setErroDoPin(null);
                }}
                placeholder="4 a 8 números"
                maxLength={PIN_MAXIMO}
                className="h-12 font-mono text-xl tracking-[0.3em]"
              />
            </div>
            <Button type="submit" className="h-12" disabled={!pinPronto || definirPin.isPending}>
              {definirPin.isPending && confirmarPin !== "desligar" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {pin?.ligado ? "Trocar o PIN" : "Ligar o PIN"}
            </Button>
            {pin?.ligado ? (
              <Button
                type="button"
                variant="outline"
                className="h-12"
                disabled={definirPin.isPending}
                onClick={() => setConfirmarPin("desligar")}
              >
                Desligar o PIN
              </Button>
            ) : null}
          </form>
          {novoPin && !pinPronto && (
            <p className="text-sm text-muted-foreground">O PIN tem de 4 a 8 números.</p>
          )}
          {pinPronto && pinObvio(novoPin) && (
            <p className="text-sm text-amber-600">
              Sequências e números repetidos, como 1234 ou 0000, são os primeiros que alguém tenta.
              A trava de 5 erros segura quem chuta às cegas; um PIN que só a oficina conhece protege
              mais.
            </p>
          )}
          {erroDoPin && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>O PIN não foi salvo</AlertTitle>
              <AlertDescription>{erroDoPin}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle>TVs com acesso</CardTitle>
            <CardDescription>
              Uma TV ligada lê o painel a cada minuto. "Sem acesso há…" é a TV apagada, sem rede ou
              fora do endereço.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void lista.refetch()}
            disabled={lista.isFetching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${lista.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {lista.isError ? (
            // Erro com dado antigo em cache também cai aqui: uma lista de um
            // minuto atrás diria "no ar" sobre uma TV que ninguém conferiu.
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Não foi possível carregar as TVs</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{mensagemErro(lista.error)}</p>
                <p>Isto é uma falha de consulta, não uma lista vazia.</p>
                <Button variant="outline" size="sm" onClick={() => void lista.refetch()}>
                  Tentar de novo
                </Button>
              </AlertDescription>
            </Alert>
          ) : lista.isPending ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando as TVs…
            </div>
          ) : ativas.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              Nenhuma TV com acesso. Abra o endereço da TV da Oficina (/tv2) no aparelho da parede e
              digite o PIN nele.
            </p>
          ) : (
            <TabelaDeTvs tvs={ativas} agora={agora} onRevogar={setARevogar} />
          )}
        </CardContent>
      </Card>

      {!lista.isError && revogadas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Revogadas</CardTitle>
            <CardDescription>
              Ficam aqui como registro de quem cortou e quando. Para voltar, digite o PIN na TV de
              novo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TabelaDeTvs tvs={revogadas} agora={agora} />
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={confirmarPin !== null}
        onOpenChange={(aberto) => !aberto && !definirPin.isPending && setConfirmarPin(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmarPin === "desligar" ? "Desligar a entrada por PIN?" : "Trocar o PIN da TV?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tvsPeloPin === 1
                ? "A TV que entrou pelo PIN atual é desconectada"
                : `As ${tvsPeloPin} TVs que entraram pelo PIN atual são desconectadas`}
              {confirmarPin === "desligar"
                ? " e nenhuma TV nova consegue entrar até o PIN ser ligado de novo."
                : " e pedem o PIN novo — digite-o nelas depois de salvar."}{" "}
              As TVs que entraram antes pelo código de pareamento continuam como estão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={definirPin.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={definirPin.isPending}
              onClick={(e) => {
                e.preventDefault();
                definirPin.mutate(confirmarPin === "desligar" ? "" : novoPin);
              }}
            >
              {definirPin.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {confirmarPin === "desligar" ? "Desligar" : "Trocar o PIN"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={aRevogar !== null} onOpenChange={(aberto) => !aberto && setARevogar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar {aRevogar?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Na próxima leitura (até um minuto) esta TV perde o painel e volta para o teclado do
              PIN. As outras TVs não são afetadas. Não dá para desfazer: para voltar, digite o PIN
              nela de novo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revogar.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={revogar.isPending}
              onClick={(e) => {
                // O diálogo fecha sozinho no clique; segura aberto até o banco responder.
                e.preventDefault();
                if (aRevogar) revogar.mutate(aRevogar);
              }}
            >
              {revogar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Revogar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TabelaDeTvs({
  tvs,
  agora,
  onRevogar,
}: {
  tvs: DispositivoDeTv[];
  agora: Date;
  onRevogar?: (tv: DispositivoDeTv) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>TV</TableHead>
            <TableHead>Situação</TableHead>
            <TableHead>Último acesso</TableHead>
            <TableHead>Entrou em</TableHead>
            {onRevogar ? (
              <TableHead className="text-right">Ação</TableHead>
            ) : (
              <TableHead>Revogada em</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {tvs.map((tv) => {
            const situacao = situacaoDaTv(tv, agora);
            return (
              <TableRow key={tv.id}>
                <TableCell className="font-medium">
                  {tv.nome}
                  {tv.entrada === "pin" ? (
                    <Badge variant="outline" className="ml-2 font-normal">
                      pelo PIN
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      situacao === "no_ar"
                        ? "default"
                        : situacao === "sem_acesso"
                          ? "destructive"
                          : "outline"
                    }
                  >
                    {textoDaSituacao(tv, agora)}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">{dataHora(tv.ultimo_acesso_em)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {dataHora(tv.criado_em)}
                  {tv.criado_por ? (
                    <span className="text-muted-foreground"> · {tv.criado_por}</span>
                  ) : null}
                </TableCell>
                {onRevogar ? (
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => onRevogar(tv)}>
                      Revogar
                    </Button>
                  </TableCell>
                ) : (
                  <TableCell className="whitespace-nowrap">
                    {dataHora(tv.revogado_em)}
                    {tv.revogado_por ? (
                      <span className="text-muted-foreground"> · {tv.revogado_por}</span>
                    ) : null}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
