import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CampoDeAcesso } from "@/components/acesso/CampoDeAcesso";
import { Button } from "@/components/ui/button";
import { mensagemErro } from "@/lib/erros";
import { CHAVE_PAINEL } from "@/lib/parceiro-api";
import { cn } from "@/lib/utils";
import { RAMOS, normalizarComprovacao } from "@/domain/parceiros/ramo";
import { CHAVE_CADASTRO_PENDENTE, validarComplemento } from "@/domain/parceiros/cadastro-rapido";

/** O <select> nativo vestido como o <Input> do CampoDeAcesso (mesma altura, borda e fundo). */
const selectCls =
  "flex h-12 w-full rounded-lg border border-border bg-background px-4 text-base shadow-none transition-colors focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 md:text-sm";

const campoCls = "border-border bg-background";

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

  async function concluir(e: FormEvent) {
    e.preventDefault();
    const falta = validarComplemento(
      { ramo, ramoOutro, comprovacao, novaSenha },
      RAMOS.map((r) => r.valor),
    );
    if (falta) {
      toast.error(falta.mensagem);
      document.getElementById(`acesso-${falta.campo === "novaSenha" ? "senha" : falta.campo === "ramoOutro" ? "ramo-outro" : falta.campo}`)?.focus();
      return;
    }
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
        const m = erroSenha.message.toLowerCase();
        if (m.includes("same") || m.includes("different"))
          throw new Error("A senha nova precisa ser diferente da provisória.");
        if (m.includes("weak") || m.includes("pwned") || m.includes("least"))
          throw new Error("Escolha uma senha mais forte: 8 ou mais caracteres, misturando letras e números.");
        throw erroSenha;
      }
      qc.invalidateQueries({ queryKey: CHAVE_PAINEL });
      toast.success("Cadastro completo. Bem-vindo ao painel!");
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setSalvando(false);
    }
  }

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
            placeholder="8 ou mais caracteres, letras e números"
            required
            minLength={8}
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
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
            A senha provisória que chegou no WhatsApp deixa de valer. Seu login continua sendo {email}.
          </p>

          {/* Ramo e comprovação: o programa é só para quem é do setor gráfico. */}
          <div className="space-y-1.5">
            <label htmlFor="acesso-ramo" className="block text-sm font-medium text-foreground">
              Qual o seu ramo?
            </label>
            <select id="acesso-ramo" className={selectCls} required value={ramo} onChange={(e) => setRamo(e.target.value)}>
              <option value="" disabled>Escolha o ramo</option>
              {RAMOS.map((r) => (
                <option key={r.valor} value={r.valor}>{r.rotulo}</option>
              ))}
            </select>
          </div>
          {ramo === "outro" && (
            <CampoDeAcesso
              id="acesso-ramo-outro"
              className={campoCls}
              rotulo="Qual é o seu ramo?"
              maxLength={120}
              required
              value={ramoOutro}
              onChange={(e) => setRamoOutro(e.target.value)}
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
              onChange={(e) => setComprovacao(e.target.value)}
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
