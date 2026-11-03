import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CircleAlert, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CampoDeAcesso } from "@/components/acesso/CampoDeAcesso";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";
import { CHAVE_PAINEL } from "@/lib/parceiro-api";
import { cn } from "@/lib/utils";
import { RAMOS, normalizarComprovacao } from "@/domain/parceiros/ramo";
import { CHAVE_CADASTRO_PENDENTE, cadastroPendente, erroDaTrocaDeSenha, validarComplemento } from "@/domain/parceiros/cadastro-rapido";

/** O <select> nativo vestido como o <Input> do CampoDeAcesso (mesma altura, borda e fundo). */
const selectCls =
  "flex h-12 w-full rounded-lg border border-border bg-background px-4 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 md:text-sm";

const campoCls = "border-border bg-background";

type CampoComErro = "novaSenha" | "ramo" | "ramoOutro" | "comprovacao";

/**
 * O primeiro acesso de quem se cadastrou pelo convite curto (03/11/2026).
 *
 * A página do convite pediu só nome, WhatsApp e e-mail, e a senha que chegou
 * pelo WhatsApp é provisória. Antes de qualquer tela do painel, esta pede UMA
 * vez o que ficou para depois: a senha definitiva, o ramo e a comprovação (o
 * programa é só para quem é do setor gráfico), cidade e documento se quiser.
 *
 * Ordem das gravações: primeiro os dados (RPC, idempotente), depois a senha e a
 * marca `cadastro_pendente: false` numa única chamada ao auth. Se a senha
 * falhar, a marca continua e a tela volta — nada fica pela metade.
 */
export function CompletarCadastro({ nome, email, onSair }: { nome: string; email: string; onSair: () => void }) {
  const qc = useQueryClient();
  const [novaSenha, setNovaSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [ramo, setRamo] = useState("");
  const [ramoOutro, setRamoOutro] = useState("");
  const [comprovacao, setComprovacao] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [documento, setDocumento] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Um erro por vez, embaixo do campo a que ele se refere (o aviso no canto da
  // tela ficava longe do campo e sumia em poucos segundos).
  const [erro, setErro] = useState<{ campo: CampoComErro; mensagem: string } | null>(null);
  const erroDe = (campo: CampoComErro) => (erro?.campo === campo ? erro.mensagem : undefined);
  const limpaErro = (campo: CampoComErro) => setErro((e) => (e?.campo === campo ? null : e));

  function mostrarErro(campo: CampoComErro, mensagem: string) {
    setErro({ campo, mensagem });
    const id = campo === "novaSenha" ? "acesso-senha" : campo === "ramoOutro" ? "acesso-ramo-outro" : `acesso-${campo}`;
    // depois do desenho: o campo pode ter acabado de ser esvaziado
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function concluir(e: FormEvent) {
    e.preventDefault();
    const falta = validarComplemento(
      { ramo, ramoOutro, comprovacao, novaSenha },
      RAMOS.map((r) => r.valor),
    );
    if (falta) {
      mostrarErro(falta.campo as CampoComErro, falta.mensagem);
      return;
    }
    setErro(null);
    setSalvando(true);
    try {
      const { error: erroRpc } = await (supabase.rpc as any)("parceiro_completar_cadastro", {
        p_dados: {
          ramo,
          ramo_outro: ramo === "outro" ? ramoOutro.trim() : null,
          comprovacao: normalizarComprovacao(comprovacao),
          cidade: cidade.trim() || null,
          estado: estado.trim().toUpperCase() || null,
          documento: documento.trim() || null,
        },
      });
      if (erroRpc) throw erroRpc;

      const { error: erroSenha } = await supabase.auth.updateUser({
        password: novaSenha,
        data: { [CHAVE_CADASTRO_PENDENTE]: false },
      });
      if (erroSenha) {
        const conhecido = erroDaTrocaDeSenha(erroSenha);
        if (!conhecido) throw erroSenha;
        if (conhecido.sairDaConta) {
          toast.error(conhecido.mensagem);
          onSair();
          return;
        }
        if (conhecido.limpar) setNovaSenha("");
        mostrarErro("novaSenha", conhecido.mensagem);
        return;
      }
      qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
      toast.success("Cadastro completo. Bem-vindo ao painel!");
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setSalvando(false);
    }
  }

  // A marca de "pendente" mora na sessão do aparelho. Quem já concluiu o cadastro
  // em outro aparelho e abre este com a sessão antiga veria a tela de novo, e a
  // senha que acabou de criar seria recusada como "igual à atual". Pergunta ao
  // servidor uma vez; se já concluiu, grava o mesmo dado para a sessão daqui
  // se atualizar e o painel abrir.
  const conferiu = useRef(false);
  useEffect(() => {
    if (conferiu.current) return;
    conferiu.current = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user && !cadastroPendente(data.user.user_metadata)) {
        void supabase.auth.updateUser({ data: { [CHAVE_CADASTRO_PENDENTE]: false } });
      }
    });
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="h-1.5" style={{ background: "var(--gradient-cmyk)" }} />
      <main className="mx-auto w-full max-w-lg px-4 py-8 sm:px-6">
        <header className="mb-6">
          <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-status-cyan">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Primeiro acesso
          </p>
          <h1 className="mt-1 text-balance text-2xl font-semibold leading-tight tracking-tight">Quase lá, {nome}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Crie a sua senha e complete o cadastro. Leva um minuto e só pedimos uma vez.
          </p>
        </header>

        <form onSubmit={concluir} noValidate className="space-y-4 rounded-2xl border border-border bg-card p-5 text-card-foreground sm:p-6">
          <CampoDeAcesso
            id="acesso-senha"
            className={campoCls}
            rotulo="Crie a sua senha"
            type={mostrarSenha ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Nova senha: 8+ caracteres, letras e números"
            required
            minLength={8}
            value={novaSenha}
            erro={erroDe("novaSenha")}
            onChange={(e) => {
              setNovaSenha(e.target.value);
              limpaErro("novaSenha");
            }}
            acao={
              <button
                type="button"
                onClick={() => setMostrarSenha((v) => !v)}
                aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={mostrarSenha}
                className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {mostrarSenha ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            }
          />
          <p className="-mt-2 text-xs text-muted-foreground">
            Crie uma senha nova, <strong className="font-semibold text-foreground">diferente da provisória</strong> do WhatsApp:
            a provisória deixa de valer. Seu login continua sendo {email}.
          </p>

          {/* Ramo e comprovação: o programa é só para quem é do setor gráfico. */}
          <div className="space-y-1.5">
            <label htmlFor="acesso-ramo" className="block text-sm font-medium text-foreground">
              Qual o seu ramo?
            </label>
            <select
              id="acesso-ramo"
              className={cn(selectCls, erroDe("ramo") && "border-status-magenta ring-2 ring-status-magenta/20")}
              required
              aria-invalid={erroDe("ramo") ? true : undefined}
              aria-describedby={erroDe("ramo") ? "acesso-ramo-erro" : undefined}
              value={ramo}
              onChange={(e) => {
                setRamo(e.target.value);
                limpaErro("ramo");
              }}
            >
              <option value="" disabled>Escolha o ramo</option>
              {RAMOS.map((r) => (
                <option key={r.valor} value={r.valor}>{r.rotulo}</option>
              ))}
            </select>
            {erroDe("ramo") && (
              <p id="acesso-ramo-erro" role="alert" className="flex items-start gap-1.5 text-sm text-status-magenta">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{erroDe("ramo")}</span>
              </p>
            )}
          </div>
          {ramo === "outro" && (
            <CampoDeAcesso
              id="acesso-ramo-outro"
              className={campoCls}
              rotulo="Qual é o seu ramo?"
              maxLength={120}
              required
              value={ramoOutro}
              erro={erroDe("ramoOutro")}
              onChange={(e) => {
                setRamoOutro(e.target.value);
                limpaErro("ramoOutro");
              }}
            />
          )}
          <div>
            <CampoDeAcesso
              id="acesso-comprovacao"
              className={campoCls}
              rotulo="Instagram ou site do seu negócio"
              placeholder="@suaempresa ou suaempresa.com.br"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={300}
              required
              value={comprovacao}
              erro={erroDe("comprovacao")}
              onChange={(e) => {
                setComprovacao(e.target.value);
                limpaErro("comprovacao");
              }}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">Usamos para confirmar que você trabalha no ramo.</p>
          </div>
          <div className="grid grid-cols-[1fr_5.5rem] gap-3">
            <CampoDeAcesso
              id="acesso-cidade"
              className={campoCls}
              rotulo="Cidade (opcional)"
              autoComplete="address-level2"
              value={cidade}
              onChange={(e) => setCidade(e.target.value)}
            />
            <CampoDeAcesso
              id="acesso-uf"
              rotulo="UF"
              maxLength={2}
              autoCapitalize="characters"
              autoComplete="address-level1"
              className={cn(campoCls, "uppercase")}
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
            />
          </div>
          <CampoDeAcesso
            id="acesso-documento"
            className={campoCls}
            rotulo="CNPJ ou CPF (opcional)"
            inputMode="numeric"
            autoComplete="off"
            value={documento}
            onChange={(e) => setDocumento(e.target.value)}
          />

          <button
            type="submit"
            disabled={salvando}
            aria-busy={salvando}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-bex-cyan text-base font-bold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {salvando ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Salvando...
              </>
            ) : (
              <>
                Concluir e abrir o painel <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Conectado como <span className="font-medium text-foreground">{email}</span>.{" "}
          <Button variant="link" className="h-auto p-0 text-sm" onClick={onSair}>
            Sair
          </Button>
        </p>
      </main>
    </div>
  );
}
