export type PublicLinkScope =
  | "quote:view"
  | "quote:approve"
  | "file:upload"
  | "art:review"
  | "payment:upload"
  | "order:status";

export type PublicAccessPayload = {
  sub: string;
  type: "quote" | "order";
  scopes: PublicLinkScope[];
  exp: number;
  iat?: number;
  nonce?: string;
};

export type PublicQuoteItem = {
  descricao: string;
  quantidade: number;
  valorUnitario: number;
};

export type PublicOrderStep = {
  label: string;
  status: "done" | "current" | "pending";
  description: string;
};

export type PublicPortalRecord = {
  quote: {
    id: string;
    numero: string;
    titulo: string;
    cliente: string;
    validade: string;
    status: "enviado" | "aprovado" | "rejeitado";
    itens: PublicQuoteItem[];
    observacoes: string;
  };
  order: {
    id: string;
    numero: string;
    titulo: string;
    status: string;
    previsao: string;
    responsavel: string;
    steps: PublicOrderStep[];
  };
  art: {
    versao: number;
    enviadaEm: string;
    observacoes: string;
  };
};

export const publicPortalRecords: Record<string, PublicPortalRecord> = {
  "orc-245": {
    quote: {
      id: "orc-245",
      numero: "245",
      titulo: "Banner lona 440g com ilhós",
      cliente: "Marcos Silva",
      validade: "2026-06-07",
      status: "enviado",
      itens: [
        { descricao: "Banner lona 440g 2m x 1m", quantidade: 5, valorUnitario: 130 },
        { descricao: "Acabamento com ilhós e bainha", quantidade: 5, valorUnitario: 18 },
      ],
      observacoes:
        "Produção liberada após aprovação do orçamento, arquivo final e confirmação do pagamento.",
    },
    order: {
      id: "os-1042",
      numero: "1042",
      titulo: "Banner lona 440g com ilhós",
      status: "Aguardando aprovação do orçamento",
      previsao: "2026-06-05",
      responsavel: "Júlia — Atendimento",
      steps: [
        {
          label: "Orçamento enviado",
          status: "done",
          description: "Proposta disponível para conferência.",
        },
        {
          label: "Aprovação",
          status: "current",
          description: "Aguardando aprovação digital do cliente.",
        },
        {
          label: "Arte e arquivo",
          status: "pending",
          description: "Envio do arquivo ou aprovação da arte final.",
        },
        { label: "Produção", status: "pending", description: "Impressão e acabamento." },
        {
          label: "Retirada",
          status: "pending",
          description: "Pedido pronto para retirada/agendamento.",
        },
      ],
    },
    art: {
      versao: 2,
      enviadaEm: "2026-05-31 11:20",
      observacoes: "Confira medidas, textos, cores e posição dos ilhós antes de aprovar.",
    },
  },
};

export function getPublicPortalRecord(subject: string) {
  return publicPortalRecords[subject] ?? publicPortalRecords["orc-245"];
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function quoteTotal(items: PublicQuoteItem[]) {
  return items.reduce((total, item) => total + item.quantidade * item.valorUnitario, 0);
}
