import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { iniciais } from "@/domain/whatsapp/caixa-de-entrada";
import { cn } from "@/lib/utils";

/**
 * A foto de perfil do contato (14/10/2026) e, sem ela, as iniciais. A foto é
 * a cópia que o servidor guardou do WhatsApp; se o link não abrir, o Avatar
 * cai sozinho para as iniciais.
 */
export function FotoDoContato({
  nome,
  url,
  className,
  classeDasIniciais,
}: {
  nome: string;
  url: string | null | undefined;
  className?: string;
  classeDasIniciais?: string;
}) {
  return (
    <Avatar className={className}>
      {url && <AvatarImage src={url} alt="" className="object-cover" />}
      <AvatarFallback className={cn(classeDasIniciais)}>{iniciais(nome)}</AvatarFallback>
    </Avatar>
  );
}
