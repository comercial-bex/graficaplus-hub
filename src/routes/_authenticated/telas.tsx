/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Tv,
} from "lucide-react";
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
  TAMANHO_DO_CODIGO,
  TAMANHO_MAXIMO_DO_NOME,
  TETO_DE_PAREAMENTOS,
  TETO_POR_ORIGEM,
  codigoDaBusca,
  codigoValido,
  formatarCodigo,
  mensagemDaRecusa,
  nomeValido,
  normalizarCodigo,
  normalizarNome,
  situacaoDaTv,
  textoDaSituacao,
  type DispositivoDeTv,
  type ListaDeTvs,
  type RespostaDaAprovacao,
} from "@/domain/tv/pareamento";
import {
  PIN_MAXIMO,
  mensagemDoDefinirPin,
  pinBemFormado,
  pinObvio,
  type RespostaDoDefinirPin,
} from "@/domain/tv/pin";

/**
 * /telas — as TVs de parede: o PIN, aprovar, dar nome, ver se estão no ar,
 * revogar.
 *
 * A TV da Oficina não tem login. Ela mostra um código (e um QR que traz esse
 * código até aqui, em `?codigo=`), e quem aprova é uma pessoa logada como
 * admin ou gestor, de pé na frente dela. Esta tela é a recepção: entrega o
 * crachá, sabe quem está com crachá e cancela um sem mexer nos outros.
 *
 * O QUE ESTA TELA NÃO FAZ
 *   - Não aprova sozinha. O código que chega pela URL só PREENCHE o campo:
 *     um link mandado por alguém de fora com o código de outra tela não pode
 *     virar acesso com um toque distraído. Quem aprova confere o código na TV.
 *   - Não mostra token nem hash: as funções do banco não devolvem nenhum dos
 *     dois. O crachá vai direto do servidor para a TV, uma vez.
 *   - Não finge lista vazia. Se a consulta cai, aparece o erro e o botão de
 *     tentar de novo — "nenhuma TV pareada" só é dito quando o banco disse.
 *
 * O PIN DA TV
 *   Com o PIN ligado, a TV mostra um teclado e quem digita o PIN certo libera
 *   o painel naquela tela, sem celular. O PIN fica no banco como hash: esta
 *   tela nunca o mostra, só troca ou desliga (`tv_definir_pin`). Trocar ou
 *   desligar desconecta as TVs que entraram pelo PIN — se o PIN vazou, é isso
 *   que corta quem entrou com ele. As aprovadas por código não mudam.
 *
 * LIBERAR A FILA
 *   Pedir código é público (a TV não tem login), e há dois tetos de pedidos
 *   abertos: 20 no total e 5 por endereço. Quando a fila pesa, o aviso traz o
 *   botão que apaga os pedidos que ninguém aprovou (`tv_limpar_pedidos`) — a
 *   TV que estava esperando pede outro código sozinha.
 *
 * A guarda de verdade está no banco (`tv_*` conferem admin/gestor a cada
 * chamada). A conferência de papel daqui só evita mostrar um formulário que o
 * banco recusaria.
 */

const CHAVE_DA_LISTA = ["tv-dispositivos"] as const;

/** Com TV aprovada esperando buscar o crachá, olha de 3 em 3 s; senão, a cada minuto. */
const ESPERANDO_A_TV_MS = 3_000;
const ROTINA_MS = 60_000;

type Busca = { codigo?: string };

export const Route = createFileRoute("/_authenticated/telas")({
  head: () => ({ meta: [{ title: "TVs da oficina — BEX PRINT OS" }] }),
  // A chave vai sempre, mesmo vazia: o roteador junta o valor cru da URL com o
  // validado, e sem ela um `?codigo=true` chegaria ao componente como booleano.
  validateSearch: (busca: Record<string, unknown>): Busca => ({
    codigo: codigoDaBusca(busca.codigo),
  }),
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
  // Já vem validado; `codigoDaBusca` de novo é cinto e suspensório contra valor
  // que não seja texto. Na URL o código tem sublinhado; no campo, hífen.
  const codigoDaUrl = formatarCodigo(codigoDaBusca(Route.useSearch().codigo) ?? "");
  const navigate = Route.useNavigate();
  const qc = useQueryClient();

  const [codigo, setCodigo] = useState(codigoDaUrl);
  const [nome, setNome] = useState("");
  const [recusa, setRecusa] = useState<string | null>(null);
  const [aRevogar, setARevogar] = useState<DispositivoDeTv | null>(null);
  const [novoPin, setNovoPin] = useState("");
  const [erroDoPin, setErroDoPin] = useState<string | null>(null);
  const [confirmarPin, setConfirmarPin] = useState<"salvar" | "desligar" | null>(null);

  // Quem já está com a tela aberta e lê o QR de outra TV chega aqui sem
  // remontar o componente: o código novo da URL tem de substituir o do campo.
  useEffect(() => {
    if (!codigoDaUrl) return;
    setCodigo(codigoDaUrl);
    setRecusa(null);
  }, [codigoDaUrl]);

  const lista = useQuery({
    queryKey: CHAVE_DA_LISTA,
    enabled: podeGerir,
    queryFn: async (): Promise<ListaDeTvs> => {
      const { data, error } = await (supabase.rpc as any)("tv_listar_dispositivos");
      if (error) throw error;
      // Resposta sem a lista não é "nenhuma TV": é resposta quebrada.
      if (!data || !Array.isArray(data.dispositivos) || !Array.isArray(data.aprovados_aguardando)) {
        throw new Error("O banco respondeu sem a lista de TVs.");
      }
      return data as ListaDeTvs;
    },
    refetchInterval: (consulta) =>
      consulta.state.data?.aprovados_aguardando.length ? ESPERANDO_A_TV_MS : ROTINA_MS,
  });

  const aprovar = useMutation({
    mutationFn: async (): Promise<RespostaDaAprovacao> => {
      const { data, error } = await (supabase.rpc as any)("tv_aprovar_pareamento", {
        p_codigo: normalizarCodigo(codigo),
        p_nome: normalizarNome(nome),
      });
      if (error) throw error;
      if (!data || typeof data.ok !== "boolean") {
        throw new Error("O banco respondeu sem dizer se a TV foi aprovada.");
      }
      return data as RespostaDaAprovacao;
    },
    onSuccess: (resposta) => {
      if (!resposta.ok) {
        // Recusa não é erro de sistema: o banco respondeu, e disse por quê.
        setRecusa(mensagemDaRecusa(resposta));
        return;
      }
      setRecusa(null);
      setCodigo("");
      setNome("");
      toast.success(`${resposta.nome} aprovada. Ela entra sozinha em alguns segundos.`);
      // Tira o código da URL: recarregar a página não pode oferecer de novo um
      // código que já foi usado.
      void navigate({ search: {}, replace: true });
      void qc.invalidateQueries({ queryKey: CHAVE_DA_LISTA });
    },
    onError: (e: unknown) => setRecusa(mensagemErro(e)),
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
      toast.success(`${tv.nome} revogada. Na próxima leitura ela volta para a tela de pareamento.`);
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

  const liberarFila = useMutation({
    mutationFn: async (): Promise<number> => {
      const { data, error } = await (supabase.rpc as any)("tv_limpar_pedidos");
      if (error) throw error;
      if (!data || data.ok !== true || typeof data.apagados !== "number") {
        throw new Error("O banco respondeu sem dizer se a fila foi liberada.");
      }
      return data.apagados;
    },
    onSuccess: (apagados) => {
      toast.success(
        apagados === 1
          ? "1 pedido de código apagado. A TV que estiver esperando mostra um código novo em instantes."
          : `${apagados} pedidos de código apagados. A TV que estiver esperando mostra um código novo em instantes.`,
      );
      void qc.invalidateQueries({ queryKey: CHAVE_DA_LISTA });
    },
    onError: (e: unknown) => toast.error(mensagemErro(e)),
  });

  if (!podeGerir) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-16 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="text-2xl font-bold tracking-tight">TVs da oficina</h1>
        <p className="text-muted-foreground">
          Só administrador ou gestor aprova e revoga TV. Se a TV está pedindo um código, chame um
          dos dois.
        </p>
      </div>
    );
  }

  const codigoLimpo = normalizarCodigo(codigo);
  const prontoParaAprovar = codigoValido(codigoLimpo) && nomeValido(nome);
  // "Há X" contra o relógio do banco, não o do navegador: celular com hora
  // errada chamaria de parada uma TV que está no ar.
  const agora = lista.data ? new Date(lista.data.agora) : new Date();
  const tvs = lista.data?.dispositivos ?? [];
  const ativas = tvs.filter((tv) => !tv.revogado_em);
  const revogadas = tvs.filter((tv) => tv.revogado_em);
  const aguardando = lista.data?.aprovados_aguardando ?? [];
  const pendentes = lista.data?.pareamentos_pendentes ?? 0;
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
          As telas de parede que mostram as máquinas. Aqui você define o PIN da TV, aprova uma TV
          nova pelo código, vê se ela está no ar e corta o acesso de uma que saiu da oficina.
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
                A TV só entra pelo código aprovado aqui embaixo.
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tv className="h-4 w-4" />
            Aprovar uma TV
          </CardTitle>
          <CardDescription>
            A TV mostra um código de {TAMANHO_DO_CODIGO} caracteres. Confira que é o código da TV
            que está na sua frente — aprovar dá a essa tela o painel das máquinas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (prontoParaAprovar && !aprovar.isPending) aprovar.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="tv-codigo">Código da TV</Label>
              <Input
                id="tv-codigo"
                value={codigo}
                onChange={(e) => {
                  setCodigo(formatarCodigo(e.target.value));
                  setRecusa(null);
                }}
                placeholder="ABC-DEF"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                inputMode="text"
                maxLength={TAMANHO_DO_CODIGO + 1}
                className="h-12 font-mono text-xl tracking-[0.2em] uppercase"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tv-nome">Nome desta TV</Label>
              <Input
                id="tv-nome"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value);
                  setRecusa(null);
                }}
                placeholder="TV da Oficina"
                maxLength={TAMANHO_MAXIMO_DO_NOME}
                className="h-12"
              />
            </div>
            <Button
              type="submit"
              className="h-12"
              disabled={!prontoParaAprovar || aprovar.isPending}
            >
              {aprovar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Aprovar
            </Button>
          </form>

          {/* A tela não sabe de onde o link veio: pedir código é público, e alguém
              de fora pode mandar o link do pedido DELE. Por isso o texto não diz
              "lido do QR" — manda conferir na TV. */}
          {codigoDaUrl && codigoLimpo === normalizarCodigo(codigoDaUrl) && (
            <p className="mt-3 text-sm text-muted-foreground">
              Este código veio por um link. Só aprove se for o mesmo que está escrito na TV à sua
              frente.
            </p>
          )}
          {codigoLimpo.length === TAMANHO_DO_CODIGO && !codigoValido(codigoLimpo) && (
            <p className="mt-3 text-sm text-destructive">
              O código da TV não tem 0, 1, I nem O. Confira o que está na tela.
            </p>
          )}
          {recusa && (
            <Alert variant="destructive" className="mt-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>A TV não foi aprovada</AlertTitle>
              <AlertDescription>{recusa}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {aguardando.map((a) => (
        <Alert key={`${a.nome}-${a.aprovado_em}`}>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{a.nome} aprovada</AlertTitle>
          <AlertDescription>
            Esperando a TV buscar o acesso. Se ela não entrar até {dataHora(a.expira_em)}, a
            aprovação vence e a TV mostra um código novo.
          </AlertDescription>
        </Alert>
      ))}

      {pendentes >= TETO_DE_PAREAMENTOS ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Fila de pareamento cheia</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Há {pendentes} pedidos de código abertos, o teto. Uma TV nova só consegue código
              quando os antigos vencerem (até 10 minutos) — ou quando você liberar a fila. Se isso
              se repetir sem ninguém estar ligando TV, alguém de fora está pedindo código à toa.
            </p>
            <BotaoLiberarFila
              ocupado={liberarFila.isPending}
              onLiberar={() => liberarFila.mutate()}
            />
          </AlertDescription>
        </Alert>
      ) : pendentes >= TETO_POR_ORIGEM ? (
        // Cada endereço pode ter até 5 pedidos vivos. Uma TV que recarrega sem
        // guardar o pedido bate nesse teto sozinha e fica dizendo "muitos
        // pedidos": daqui o admin destrava sem esperar os 10 minutos.
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{pendentes} pedidos de código abertos</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Se a TV está dizendo que há pedidos demais, libere a fila: os códigos que ninguém
              aprovou são apagados e ela mostra um novo.
            </p>
            <BotaoLiberarFila
              ocupado={liberarFila.isPending}
              onLiberar={() => liberarFila.mutate()}
            />
          </AlertDescription>
        </Alert>
      ) : null}

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
              digite o PIN nele — ou aprove aqui o código que ele mostrar.
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
              Ficam aqui como registro de quem cortou e quando. Para voltar, a TV precisa ser
              aprovada de novo.
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
                ? " e passam a pedir o código de pareamento."
                : " e pedem o PIN novo — digite-o nelas depois de salvar."}{" "}
              As TVs aprovadas por código continuam como estão.
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
              Na próxima leitura (até um minuto) esta TV perde o painel e volta para a tela de
              entrada (o teclado do PIN, ou o código de pareamento). As outras TVs não são afetadas.
              Não dá para desfazer: para voltar, ela entra de novo pelo PIN ou pelo código.
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

function BotaoLiberarFila({ ocupado, onLiberar }: { ocupado: boolean; onLiberar: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onLiberar} disabled={ocupado}>
      {ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      Liberar a fila
    </Button>
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
