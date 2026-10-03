import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { mensagemErro } from "@/lib/erros";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  conferirSenha,
  pedeReautenticacao,
  TAMANHO_MINIMO_DA_SENHA,
} from "@/components/configuracoes/perfil";

/**
 * Trocar a própria senha pelo Supabase Auth.
 *
 * Pede a senha atual e confere entrando com ela antes de trocar: sem isso,
 * quem pegasse o celular desbloqueado de alguém trocaria a senha do dono e o
 * deixaria de fora. Quem não lembra a atual recebe o link por e-mail — o mesmo
 * fluxo do "esqueci a senha" do login, que abre /reset-password.
 */
export function SenhaCard() {
  const { user } = useAuth();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [problemas, setProblemas] = useState<string[]>([]);
  const [trocando, setTrocando] = useState(false);
  const [mandandoLink, setMandandoLink] = useState(false);

  async function trocar(e: FormEvent) {
    e.preventDefault();
    const p = conferirSenha({ atual, nova, confirmacao });
    setProblemas(p);
    if (p.length > 0) return;
    if (!user?.email) {
      setProblemas(["Sua conta não tem e-mail de entrada; peça ao administrador para trocar a senha."]);
      return;
    }

    setTrocando(true);
    try {
      const { error: erroAtual } = await supabase.auth.signInWithPassword({ email: user.email, password: atual });
      if (erroAtual) {
        setProblemas([
          /invalid login credentials/i.test(erroAtual.message)
            ? "A senha atual não confere."
            : mensagemErro(erroAtual, "Não foi possível conferir a senha atual."),
        ]);
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: nova });
      if (error) {
        setProblemas([
          pedeReautenticacao(error)
            ? "Por segurança, o sistema pede confirmação por e-mail para trocar a senha. Use “Mandar link para meu e-mail” logo abaixo."
            : mensagemErro(error, "Não foi possível trocar a senha."),
        ]);
        return;
      }
      setAtual("");
      setNova("");
      setConfirmacao("");
      toast.success("Senha trocada. Use a nova no próximo login.");
    } finally {
      setTrocando(false);
    }
  }

  async function mandarLink() {
    if (!user?.email) return;
    setMandandoLink(true);
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setMandandoLink(false);
    if (error) return toast.error(mensagemErro(error));
    toast.success(`Mandamos um link para ${user.email}. Ele abre a tela de criar a nova senha.`);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> Senha
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={trocar} className="space-y-4">
          {/* Campo de usuário escondido: o gerenciador de senhas do navegador
              precisa dele para saber de qual conta é a senha nova. */}
          <input type="email" name="username" autoComplete="username" value={user?.email ?? ""} readOnly hidden />
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="senha-atual">Senha atual</Label>
              <Input
                id="senha-atual"
                type="password"
                autoComplete="current-password"
                value={atual}
                onChange={(e) => setAtual(e.target.value)}
                className="h-11 md:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senha-nova">Nova senha</Label>
              <Input
                id="senha-nova"
                type="password"
                autoComplete="new-password"
                minLength={TAMANHO_MINIMO_DA_SENHA}
                value={nova}
                onChange={(e) => setNova(e.target.value)}
                placeholder={`Mínimo ${TAMANHO_MINIMO_DA_SENHA} caracteres`}
                className="h-11 md:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senha-confirmacao">Repita a nova</Label>
              <Input
                id="senha-confirmacao"
                type="password"
                autoComplete="new-password"
                value={confirmacao}
                onChange={(e) => setConfirmacao(e.target.value)}
                className="h-11 md:h-9"
              />
            </div>
          </div>

          {problemas.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              {problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="link"
              className="h-11 px-0 md:h-9"
              disabled={mandandoLink || !user?.email}
              onClick={mandarLink}
            >
              <Mail className="mr-1 h-4 w-4" />
              {mandandoLink ? "Mandando…" : "Esqueci a atual: mandar link para meu e-mail"}
            </Button>
            <Button type="submit" className="h-11 md:h-9" disabled={trocando}>
              {trocando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1 h-4 w-4" />}
              Trocar senha
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
