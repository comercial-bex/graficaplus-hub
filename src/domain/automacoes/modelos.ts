/**
 * Modelos prontos — só o que o motor executa, e só o que ninguém já faz.
 *
 * Os três avisam a EQUIPE, não o cliente. O cliente já recebe, sozinho, os
 * avisos de arte para aprovar, produção, pronto para retirada, saiu para
 * entrega e concluído (notificacoes_fila + notificacao_templates, ver
 * `ETAPAS_COM_AVISO_AO_CLIENTE`). Um modelo "avisar o cliente que está pronto"
 * seria a segunda mensagem sobre a mesma coisa.
 *
 * Nenhum modelo é criado sozinho: clicar abre o formulário preenchido, e quem
 * salva é a pessoa — depois de pôr o número que vai receber. Ficou de fora de
 * propósito o de estoque mínimo: em 02/10/2026, 16 dos 18 materiais estavam
 * no mínimo ou abaixo, e o modelo nasceria mandando 16 mensagens por dia.
 */
import { FORM_VAZIO, type FormAutomacao } from "./formulario";

export type ModeloAutomacao = {
  id: string;
  titulo: string;
  porque: string;
  form: FormAutomacao;
};

export const MODELOS: ModeloAutomacao[] = [
  {
    id: "os-atrasada-equipe",
    titulo: "Avisar a equipe quando uma OS atrasar",
    porque:
      "O prazo passa e a OS fica no meio do quadro sem ninguém perceber. Um aviso por dia, para o número da equipe, enquanto ela estiver atrasada.",
    form: {
      ...FORM_VAZIO,
      nome: "OS atrasada — avisar a equipe",
      descricao: "Modelo pronto: OS que passou do prazo de entrega.",
      gatilho: "os_atrasada",
      destino: "fixo",
      mensagem:
        "Atenção: a OS {{os.numero}} ({{cliente.nome}}) passou do prazo de entrega ({{os.prazo_entrega}}) e ainda não foi concluída.",
      intervaloSegundos: 86400,
    },
  },
  {
    id: "ajuste-de-arte-design",
    titulo: "Avisar o design quando o cliente pedir ajuste na arte",
    porque:
      "Quando o cliente pede ajuste pelo link, a OS vai para “Arte rejeitada” e espera alguém abrir o sistema. O aviso chega na hora para quem vai refazer.",
    form: {
      ...FORM_VAZIO,
      nome: "Ajuste de arte — avisar o design",
      descricao: "Modelo pronto: cliente pediu ajuste na arte.",
      gatilho: "status_os_alterado",
      etapas: ["arte_rejeitada"],
      destino: "fixo",
      mensagem:
        "O cliente {{cliente.nome}} pediu ajuste na arte da OS {{os.numero}}. O pedido está em Design & Arte.",
      intervaloSegundos: 3600,
    },
  },
  {
    id: "arte-aprovada-producao",
    titulo: "Avisar a produção quando a arte for aprovada",
    porque:
      "Arte aprovada é o sinal de que a OS pode ir para a máquina. Sem aviso, ela espera alguém olhar o quadro.",
    form: {
      ...FORM_VAZIO,
      nome: "Arte aprovada — avisar a produção",
      descricao: "Modelo pronto: arte aprovada, OS liberada para produzir.",
      gatilho: "status_os_alterado",
      etapas: ["arte_aprovada"],
      destino: "fixo",
      mensagem:
        "Arte da OS {{os.numero}} ({{cliente.nome}}) aprovada. Pode entrar na fila de produção.",
      intervaloSegundos: 3600,
    },
  },
];
