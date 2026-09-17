import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mensagemErro } from "@/lib/erros";
import { criarContaSemPapel } from "@/lib/criar-usuario";
import {
  buscarContaParaParceiro,
  vincularUsuarioAoParceiro,
  type ResumoDoParceiro,
  type UsuarioEncontrado,
} from "@/lib/parceiro-api";

function gerarSenha() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return `${Array.from(buf, (n) => letras[n % letras.length]).join("")}@7`;
}

/**
 * Dá ao parceiro o login do painel.
 *
 * Dois caminhos: criar a conta aqui (o mais comum — a equipe passa o acesso pelo
 * WhatsApp) ou ligar uma conta que a pessoa já criou na tela de cadastro. Nos
 * dois o papel `parceiro` é gravado pelo banco, que recusa conta da equipe.
 */
export function AcessoDialog({
  parceiro,
  onOpenChange,
}: {
  parceiro: ResumoDoParceiro | null;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<UsuarioEncontrado[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pronto, setPronto] = useState<{ email: string; senha: string | null; confirmar: boolean } | null>(null);

  useEffect(() => {
    if (parceiro) {
      setNome(parceiro.nome);
      setEmail("");
      setSenha(gerarSenha());
      setBusca("");
      setAchados(null);
      setPronto(null);
    }
  }, [parceiro]);

  if (!parceiro) return null;

  async function criarLogin() {
    if (!parceiro) return;
    setOcupado(true);
    try {
      const conta = await criarContaSemPapel({
        nome,
        email,
        senha,
        seJaExiste: "Já existe uma conta com este e-mail. Use a aba \"Conta que já existe\".",
      });
      if (!conta.ok) throw new Error(conta.erro);
      await vincularUsuarioAoParceiro(parceiro.id, conta.usuarioId);
      setPronto({ email: email.trim().toLowerCase(), senha, confirmar: conta.precisaConfirmarEmail });
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível criar o acesso."));
    } finally {
      setOcupado(false);
    }
  }

  async function procurar() {
    if (busca.trim().length < 3) return toast.error("Digite ao menos 3 letras do e-mail ou do nome.");
    setOcupado(true);
    try {
      setAchados(await buscarContaParaParceiro(busca.trim()));
    } catch (e) {
      toast.error(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function ligar(u: UsuarioEncontrado) {
    if (!parceiro) return;
    setOcupado(true);
    try {
      await vincularUsuarioAoParceiro(parceiro.id, u.id);
      setPronto({ email: u.email ?? "", senha: null, confirmar: false });
      qc.invalidateQueries({ queryKey: ["parceiros-resumo"] });
    } catch (e) {
      toast.error(mensagemErro(e, "Não foi possível ligar a conta."));
    } finally {
      setOcupado(false);
    }
  }

  const endereco = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";
  const mensagem = pronto
    ? `Olá! Seu painel de parceiro da gráfica já está liberado.\nAcesse: ${endereco}\nE-mail: ${pronto.email}${pronto.senha ? `\nSenha: ${pronto.senha}` : ""}\nLá você faz orçamento com a sua marca, vê sua tabela e acompanha seus pedidos.`
    : "";

  return (
    <Dialog open={!!parceiro} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Acesso ao painel · {parceiro.nome}
          </DialogTitle>
          <DialogDescription>
            {parceiro.usuario_email
              ? `Hoje o acesso é de ${parceiro.usuario_email}. Criar ou ligar outra conta substitui esta.`
              : "O parceiro ainda não tem login."}
          </DialogDescription>
        </DialogHeader>

        {pronto ? (
          <div className="space-y-3">
            <p className="text-sm">
              Acesso liberado para <span className="font-medium">{pronto.email}</span>.
              {pronto.confirmar && " O parceiro precisa confirmar o e-mail pelo link que chegou antes de entrar."}
            </p>
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-foreground/5 p-3 text-xs">{mensagem}</pre>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(mensagem).then(
                    () => toast.success("Mensagem copiada — cole no WhatsApp do parceiro"),
                    () => toast.error("Não deu para copiar. Selecione o texto e copie."),
                  );
                }}
              >
                <Copy className="mr-1 h-4 w-4" /> Copiar mensagem
              </Button>
              <Button onClick={() => onOpenChange(false)}>Pronto</Button>
            </DialogFooter>
          </div>
        ) : (
          <Tabs defaultValue="criar">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="criar">Criar login</TabsTrigger>
              <TabsTrigger value="existente">Conta que já existe</TabsTrigger>
            </TabsList>
            <TabsContent value="criar" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="acesso-nome">Nome</Label>
                <Input id="acesso-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acesso-email">E-mail do parceiro</Label>
                <Input id="acesso-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acesso-senha">Senha inicial</Label>
                <div className="flex gap-2">
                  <Input id="acesso-senha" value={senha} onChange={(e) => setSenha(e.target.value)} />
                  <Button type="button" variant="outline" onClick={() => setSenha(gerarSenha())}>
                    Gerar
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Passe para o parceiro por um canal só dele. Ele pode trocar pela opção “Esqueci a senha”.
                </p>
              </div>
              <DialogFooter>
                <Button onClick={criarLogin} disabled={ocupado || !email.includes("@") || senha.length < 8 || !nome.trim()}>
                  <UserPlus className="mr-1 h-4 w-4" />
                  {ocupado ? "Criando…" : "Criar e liberar"}
                </Button>
              </DialogFooter>
            </TabsContent>
            <TabsContent value="existente" className="space-y-3 pt-2">
              <p className="text-sm text-muted-foreground">
                Para quem já criou a conta na tela de cadastro. Contas da equipe não aparecem.
              </p>
              <div className="flex gap-2">
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && procurar()}
                  placeholder="E-mail ou nome"
                  aria-label="Procurar conta"
                />
                <Button variant="outline" onClick={procurar} disabled={ocupado}>
                  <Search className="mr-1 h-4 w-4" /> Procurar
                </Button>
              </div>
              {achados !== null &&
                (achados.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma conta encontrada.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {achados.map((u) => (
                      <li key={u.id} className="flex items-center justify-between gap-3 p-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{u.nome ?? "—"}</p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                        <Button size="sm" onClick={() => ligar(u)} disabled={ocupado}>
                          Liberar
                        </Button>
                      </li>
                    ))}
                  </ul>
                ))}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
