export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agenda_maquinas: {
        Row: {
          id: string
          maquina_id: string
          os_id: string | null
          item_os_id: string | null
          operador_id: string | null
          titulo: string
          descricao: string | null
          inicio: string
          fim: string
          status: string
          prioridade: number
          observacoes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          maquina_id: string
          os_id?: string | null
          item_os_id?: string | null
          operador_id?: string | null
          titulo: string
          descricao?: string | null
          inicio: string
          fim: string
          status?: string
          prioridade?: number
          observacoes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          maquina_id?: string
          os_id?: string | null
          item_os_id?: string | null
          operador_id?: string | null
          titulo?: string
          descricao?: string | null
          inicio?: string
          fim?: string
          status?: string
          prioridade?: number
          observacoes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      automacao_execucoes: {
        Row: {
          id: string
          automacao_id: string | null
          referencia_tipo: string | null
          referencia_id: string | null
          status: string
          entrada: Json
          resultado: Json
          erro: string | null
          executado_em: string
        }
        Insert: {
          id?: string
          automacao_id?: string | null
          referencia_tipo?: string | null
          referencia_id?: string | null
          status?: string
          entrada?: Json
          resultado?: Json
          erro?: string | null
          executado_em?: string
        }
        Update: {
          id?: string
          automacao_id?: string | null
          referencia_tipo?: string | null
          referencia_id?: string | null
          status?: string
          entrada?: Json
          resultado?: Json
          erro?: string | null
          executado_em?: string
        }
        Relationships: []
      }
      automacoes: {
        Row: {
          id: string
          nome: string
          descricao: string | null
          gatilho: string
          canal: string
          condicoes: Json
          acoes: Json
          ativa: boolean
          ultima_execucao: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nome: string
          descricao?: string | null
          gatilho: string
          canal?: string
          condicoes?: Json
          acoes?: Json
          ativa: boolean
          ultima_execucao?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nome?: string
          descricao?: string | null
          gatilho?: string
          canal?: string
          condicoes?: Json
          acoes?: Json
          ativa?: boolean
          ultima_execucao?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      checklist_itens_modelo: {
        Row: {
          id: string
          modelo_id: string
          titulo: string
          descricao: string | null
          obrigatorio: boolean
          ordem: number
          created_at: string
        }
        Insert: {
          id?: string
          modelo_id: string
          titulo: string
          descricao?: string | null
          obrigatorio?: boolean
          ordem?: number
          created_at?: string
        }
        Update: {
          id?: string
          modelo_id?: string
          titulo?: string
          descricao?: string | null
          obrigatorio?: boolean
          ordem?: number
          created_at?: string
        }
        Relationships: []
      }
      checklist_modelos: {
        Row: {
          id: string
          nome: string
          descricao: string | null
          tipo: string
          produto_id: string | null
          ativo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nome: string
          descricao?: string | null
          tipo?: string
          produto_id?: string | null
          ativo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nome?: string
          descricao?: string | null
          tipo?: string
          produto_id?: string | null
          ativo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      checklist_respostas: {
        Row: {
          id: string
          checklist_id: string
          item_modelo_id: string | null
          valor: boolean
          observacao: string | null
          respondido_por: string | null
          respondido_em: string | null
          created_at: string
        }
        Insert: {
          id?: string
          checklist_id: string
          item_modelo_id?: string | null
          valor?: boolean
          observacao?: string | null
          respondido_por?: string | null
          respondido_em?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          checklist_id?: string
          item_modelo_id?: string | null
          valor?: boolean
          observacao?: string | null
          respondido_por?: string | null
          respondido_em?: string | null
          created_at?: string
        }
        Relationships: []
      }
      checklists_os: {
        Row: {
          id: string
          os_id: string
          modelo_id: string | null
          status: string
          responsavel_id: string | null
          concluido_em: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          os_id: string
          modelo_id?: string | null
          status?: string
          responsavel_id?: string | null
          concluido_em?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          os_id?: string
          modelo_id?: string | null
          status?: string
          responsavel_id?: string | null
          concluido_em?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      historico_alteracoes: {
        Row: {
          id: string
          entidade: string
          entidade_id: string
          acao: string
          campo: string | null
          valor_anterior: Json | null
          valor_novo: Json | null
          usuario_id: string | null
          origem: string
          created_at: string
        }
        Insert: {
          id?: string
          entidade: string
          entidade_id: string
          acao: string
          campo?: string | null
          valor_anterior?: Json | null
          valor_novo?: Json | null
          usuario_id?: string | null
          origem?: string
          created_at?: string
        }
        Update: {
          id?: string
          entidade?: string
          entidade_id?: string
          acao?: string
          campo?: string | null
          valor_anterior?: Json | null
          valor_novo?: Json | null
          usuario_id?: string | null
          origem?: string
          created_at?: string
        }
        Relationships: []
      }
      historico_os_status: {
        Row: {
          id: string
          os_id: string
          status_anterior: Database["public"]["Enums"]["status_os"] | null
          status_novo: Database["public"]["Enums"]["status_os"]
          usuario_id: string | null
          observacao: string | null
          created_at: string
        }
        Insert: {
          id?: string
          os_id: string
          status_anterior?: Database["public"]["Enums"]["status_os"] | null
          status_novo: Database["public"]["Enums"]["status_os"]
          usuario_id?: string | null
          observacao?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          os_id?: string
          status_anterior?: Database["public"]["Enums"]["status_os"] | null
          status_novo?: Database["public"]["Enums"]["status_os"]
          usuario_id?: string | null
          observacao?: string | null
          created_at?: string
        }
        Relationships: []
      }
      manutencoes: {
        Row: {
          id: string
          maquina_id: string
          responsavel_id: string | null
          tipo: string
          titulo: string
          descricao: string | null
          status: string
          data_programada: string | null
          data_inicio: string | null
          data_conclusao: string | null
          custo_previsto: number
          custo_real: number
          observacoes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          maquina_id: string
          responsavel_id?: string | null
          tipo?: string
          titulo: string
          descricao?: string | null
          status?: string
          data_programada?: string | null
          data_inicio?: string | null
          data_conclusao?: string | null
          custo_previsto?: number
          custo_real?: number
          observacoes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          maquina_id?: string
          responsavel_id?: string | null
          tipo?: string
          titulo?: string
          descricao?: string | null
          status?: string
          data_programada?: string | null
          data_inicio?: string | null
          data_conclusao?: string | null
          custo_previsto?: number
          custo_real?: number
          observacoes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      pos_calculo_itens: {
        Row: {
          id: string
          pos_calculo_id: string
          item_os_id: string | null
          descricao: string
          custo_previsto: number
          custo_real: number
          quantidade: number
          observacoes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pos_calculo_id: string
          item_os_id?: string | null
          descricao: string
          custo_previsto?: number
          custo_real?: number
          quantidade?: number
          observacoes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          pos_calculo_id?: string
          item_os_id?: string | null
          descricao?: string
          custo_previsto?: number
          custo_real?: number
          quantidade?: number
          observacoes?: string | null
          created_at?: string
        }
        Relationships: []
      }
      pos_calculos: {
        Row: {
          id: string
          os_id: string
          valor_venda: number
          custo_previsto: number
          custo_real: number
          lucro_previsto: number
          lucro_real: number
          margem_prevista: number | null
          margem_real: number | null
          divergencias: Json
          observacoes: string | null
          calculado_por: string | null
          calculado_em: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          os_id: string
          valor_venda?: number
          custo_previsto?: number
          custo_real?: number
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          margem_real?: number | null
          divergencias?: Json
          observacoes?: string | null
          calculado_por?: string | null
          calculado_em?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          os_id?: string
          valor_venda?: number
          custo_previsto?: number
          custo_real?: number
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          margem_real?: number | null
          divergencias?: Json
          observacoes?: string | null
          calculado_por?: string | null
          calculado_em?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      produto_precificacao: {
        Row: {
          id: string
          produto_id: string
          material_id: string | null
          maquina_id: string | null
          nome: string
          unidade: string
          quantidade_base: number
          custo_material: number
          custo_maquina: number
          custo_mao_obra: number
          custo_indireto: number
          margem_percentual: number
          preco_calculado: number
          ativo: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          produto_id: string
          material_id?: string | null
          maquina_id?: string | null
          nome: string
          unidade?: string
          quantidade_base?: number
          custo_material?: number
          custo_maquina?: number
          custo_mao_obra?: number
          custo_indireto?: number
          margem_percentual?: number
          preco_calculado?: number
          ativo?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          produto_id?: string
          material_id?: string | null
          maquina_id?: string | null
          nome?: string
          unidade?: string
          quantidade_base?: number
          custo_material?: number
          custo_maquina?: number
          custo_mao_obra?: number
          custo_indireto?: number
          margem_percentual?: number
          preco_calculado?: number
          ativo?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_contas: {
        Row: {
          id: string
          nome: string
          numero: string
          provedor: string
          phone_number_id: string | null
          business_account_id: string | null
          status: string
          configuracoes: Json
          ultimo_sync: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          nome: string
          numero: string
          provedor?: string
          phone_number_id?: string | null
          business_account_id?: string | null
          status?: string
          configuracoes?: Json
          ultimo_sync?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          nome?: string
          numero?: string
          provedor?: string
          phone_number_id?: string | null
          business_account_id?: string | null
          status?: string
          configuracoes?: Json
          ultimo_sync?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_contatos: {
        Row: {
          id: string
          cliente_id: string | null
          contato_id: string | null
          nome: string | null
          telefone: string
          wa_id: string | null
          opt_in: boolean
          ultima_interacao: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          cliente_id?: string | null
          contato_id?: string | null
          nome?: string | null
          telefone: string
          wa_id?: string | null
          opt_in?: boolean
          ultima_interacao?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          cliente_id?: string | null
          contato_id?: string | null
          nome?: string | null
          telefone?: string
          wa_id?: string | null
          opt_in?: boolean
          ultima_interacao?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_conversas: {
        Row: {
          id: string
          conta_id: string | null
          whatsapp_contato_id: string
          cliente_id: string | null
          os_id: string | null
          status: string
          assunto: string | null
          responsavel_id: string | null
          ultima_mensagem_em: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          conta_id?: string | null
          whatsapp_contato_id: string
          cliente_id?: string | null
          os_id?: string | null
          status?: string
          assunto?: string | null
          responsavel_id?: string | null
          ultima_mensagem_em?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          conta_id?: string | null
          whatsapp_contato_id?: string
          cliente_id?: string | null
          os_id?: string | null
          status?: string
          assunto?: string | null
          responsavel_id?: string | null
          ultima_mensagem_em?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_disparos: {
        Row: {
          id: string
          template_id: string | null
          automacao_id: string | null
          nome: string
          status: string
          filtros: Json
          total_destinatarios: number
          total_enviados: number
          total_falhas: number
          agendado_para: string | null
          iniciado_em: string | null
          concluido_em: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          template_id?: string | null
          automacao_id?: string | null
          nome: string
          status?: string
          filtros?: Json
          total_destinatarios?: number
          total_enviados?: number
          total_falhas?: number
          agendado_para?: string | null
          iniciado_em?: string | null
          concluido_em?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          template_id?: string | null
          automacao_id?: string | null
          nome?: string
          status?: string
          filtros?: Json
          total_destinatarios?: number
          total_enviados?: number
          total_falhas?: number
          agendado_para?: string | null
          iniciado_em?: string | null
          concluido_em?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_mensagens: {
        Row: {
          id: string
          conversa_id: string
          conta_id: string | null
          remetente_tipo: string
          direcao: string
          tipo: string
          conteudo: string | null
          media_url: string | null
          template_nome: string | null
          provider_message_id: string | null
          status: string
          erro: string | null
          enviado_por: string | null
          enviado_em: string | null
          entregue_em: string | null
          lido_em: string | null
          created_at: string
        }
        Insert: {
          id?: string
          conversa_id: string
          conta_id?: string | null
          remetente_tipo?: string
          direcao?: string
          tipo?: string
          conteudo?: string | null
          media_url?: string | null
          template_nome?: string | null
          provider_message_id?: string | null
          status?: string
          erro?: string | null
          enviado_por?: string | null
          enviado_em?: string | null
          entregue_em?: string | null
          lido_em?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          conversa_id?: string
          conta_id?: string | null
          remetente_tipo?: string
          direcao?: string
          tipo?: string
          conteudo?: string | null
          media_url?: string | null
          template_nome?: string | null
          provider_message_id?: string | null
          status?: string
          erro?: string | null
          enviado_por?: string | null
          enviado_em?: string | null
          entregue_em?: string | null
          lido_em?: string | null
          created_at?: string
        }
        Relationships: []
      }
      whatsapp_templates: {
        Row: {
          id: string
          conta_id: string | null
          nome: string
          categoria: string | null
          idioma: string
          corpo: string
          parametros: Json
          status: string
          provider_template_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          conta_id?: string | null
          nome: string
          categoria?: string | null
          idioma: string
          corpo: string
          parametros?: Json
          status?: string
          provider_template_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          conta_id?: string | null
          nome?: string
          categoria?: string | null
          idioma?: string
          corpo?: string
          parametros?: Json
          status?: string
          provider_template_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_webhooks: {
        Row: {
          id: string
          conta_id: string | null
          provider_event_id: string | null
          evento: string
          payload: Json
          processado: boolean
          erro: string | null
          recebido_em: string
          processado_em: string | null
        }
        Insert: {
          id?: string
          conta_id?: string | null
          provider_event_id?: string | null
          evento: string
          payload?: Json
          processado?: boolean
          erro?: string | null
          recebido_em?: string
          processado_em?: string | null
        }
        Update: {
          id?: string
          conta_id?: string | null
          provider_event_id?: string | null
          evento?: string
          payload?: Json
          processado?: boolean
          erro?: string | null
          recebido_em?: string
          processado_em?: string | null
        }
        Relationships: []
      }
      aprovacoes: {
        Row: {
          aprovado: boolean
          arquivo_id: string | null
          canal: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id: string | null
          created_at: string
          id: string
          observacao: string | null
          orcamento_id: string | null
          os_id: string | null
          tipo: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id: string | null
        }
        Insert: {
          aprovado: boolean
          arquivo_id?: string | null
          canal?: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id?: string | null
          created_at?: string
          id?: string
          observacao?: string | null
          orcamento_id?: string | null
          os_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id?: string | null
        }
        Update: {
          aprovado?: boolean
          arquivo_id?: string | null
          canal?: Database["public"]["Enums"]["canal_aprovacao"]
          cliente_contato_id?: string | null
          created_at?: string
          id?: string
          observacao?: string | null
          orcamento_id?: string | null
          os_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_aprovacao"]
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aprovacoes_arquivo_id_fkey"
            columns: ["arquivo_id"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_cliente_contato_id_fkey"
            columns: ["cliente_contato_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aprovacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      arquivos: {
        Row: {
          aprovado_por: string | null
          ativo: boolean
          caminho: string
          cliente_id: string | null
          conversa_id: string | null
          created_at: string
          data_aprovacao: string | null
          enviado_por: string | null
          final_producao: boolean
          id: string
          mime_type: string | null
          nome: string
          observacao: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["status_arquivo"]
          substituido_por: string | null
          tamanho_bytes: number | null
          tarefa_id: string | null
          tipo: Database["public"]["Enums"]["tipo_arquivo"]
          url: string | null
          versao: number
        }
        Insert: {
          aprovado_por?: string | null
          ativo?: boolean
          caminho: string
          cliente_id?: string | null
          conversa_id?: string | null
          created_at?: string
          data_aprovacao?: string | null
          enviado_por?: string | null
          final_producao?: boolean
          id?: string
          mime_type?: string | null
          nome: string
          observacao?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["status_arquivo"]
          substituido_por?: string | null
          tamanho_bytes?: number | null
          tarefa_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_arquivo"]
          url?: string | null
          versao?: number
        }
        Update: {
          aprovado_por?: string | null
          ativo?: boolean
          caminho?: string
          cliente_id?: string | null
          conversa_id?: string | null
          created_at?: string
          data_aprovacao?: string | null
          enviado_por?: string | null
          final_producao?: boolean
          id?: string
          mime_type?: string | null
          nome?: string
          observacao?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["status_arquivo"]
          substituido_por?: string | null
          tamanho_bytes?: number | null
          tarefa_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_arquivo"]
          url?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "arquivos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_substituido_por_fkey"
            columns: ["substituido_por"]
            isOneToOne: false
            referencedRelation: "arquivos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arquivos_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_contatos: {
        Row: {
          cargo: string | null
          cliente_id: string
          created_at: string
          email: string | null
          id: string
          nome: string
          principal: boolean
          telefone: string | null
        }
        Insert: {
          cargo?: string | null
          cliente_id: string
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          principal?: boolean
          telefone?: string | null
        }
        Update: {
          cargo?: string | null
          cliente_id?: string
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          principal?: boolean
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_contatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          ativo: boolean
          cep: string | null
          cidade: string | null
          created_at: string
          created_by: string | null
          documento: string | null
          email: string | null
          endereco: string | null
          estado: string | null
          id: string
          logo_url: string | null
          nome: string
          observacoes: string | null
          razao_social: string | null
          telefone: string | null
          tipo: Database["public"]["Enums"]["tipo_cliente"]
          updated_at: string
          vendedor_id: string | null

          nome_fantasia: string | null
          cpf_cnpj: string | null
          whatsapp_principal: string | null
          bairro: string | null
          origem: string | null
          tipo_cliente: Database["public"]["Enums"]["tipo_cliente"]
          status: string
          ultima_interacao: string | null
        }
        Insert: {
          ativo?: boolean
          cep?: string | null
          cidade?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          nome: string
          observacoes?: string | null
          razao_social?: string | null
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["tipo_cliente"]
          updated_at?: string
          vendedor_id?: string | null

          nome_fantasia?: string | null
          cpf_cnpj?: string | null
          whatsapp_principal?: string | null
          bairro?: string | null
          origem?: string | null
          tipo_cliente?: Database["public"]["Enums"]["tipo_cliente"]
          status?: string
          ultima_interacao?: string | null
        }
        Update: {
          ativo?: boolean
          cep?: string | null
          cidade?: string | null
          created_at?: string
          created_by?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          estado?: string | null
          id?: string
          logo_url?: string | null
          nome?: string
          observacoes?: string | null
          razao_social?: string | null
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["tipo_cliente"]
          updated_at?: string
          vendedor_id?: string | null

          nome_fantasia?: string | null
          cpf_cnpj?: string | null
          whatsapp_principal?: string | null
          bairro?: string | null
          origem?: string | null
          tipo_cliente?: Database["public"]["Enums"]["tipo_cliente"]
          status?: string
          ultima_interacao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      comentarios_tarefa: {
        Row: {
          autor_id: string | null
          created_at: string
          id: string
          tarefa_id: string
          texto: string
        }
        Insert: {
          autor_id?: string | null
          created_at?: string
          id?: string
          tarefa_id: string
          texto: string
        }
        Update: {
          autor_id?: string | null
          created_at?: string
          id?: string
          tarefa_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "comentarios_tarefa_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_tarefa_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      custos_os: {
        Row: {
          categoria: string | null
          created_at: string
          data: string
          descricao: string
          id: string
          os_id: string
          registrado_por: string | null
          valor: number
        }
        Insert: {
          categoria?: string | null
          created_at?: string
          data?: string
          descricao: string
          id?: string
          os_id: string
          registrado_por?: string | null
          valor: number
        }
        Update: {
          categoria?: string | null
          created_at?: string
          data?: string
          descricao?: string
          id?: string
          os_id?: string
          registrado_por?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "custos_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custos_os_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_gerados: {
        Row: {
          caminho: string
          created_at: string
          gerado_por: string | null
          id: string
          numero: number | null
          referencia_id: string
          tamanho_bytes: number | null
          tipo: string
          variante: string
        }
        Insert: {
          caminho: string
          created_at?: string
          gerado_por?: string | null
          id?: string
          numero?: number | null
          referencia_id: string
          tamanho_bytes?: number | null
          tipo: string
          variante?: string
        }
        Update: {
          caminho?: string
          created_at?: string
          gerado_por?: string | null
          id?: string
          numero?: number | null
          referencia_id?: string
          tamanho_bytes?: number | null
          tipo?: string
          variante?: string
        }
        Relationships: []
      }
      entregas_instalacoes: {
        Row: {
          created_at: string
          data_agendada: string | null
          data_realizada: string | null
          endereco: string | null
          id: string
          instalador_id: string | null
          observacoes: string | null
          os_id: string
          status: string
          tipo: string
        }
        Insert: {
          created_at?: string
          data_agendada?: string | null
          data_realizada?: string | null
          endereco?: string | null
          id?: string
          instalador_id?: string | null
          observacoes?: string | null
          os_id: string
          status?: string
          tipo?: string
        }
        Update: {
          created_at?: string
          data_agendada?: string | null
          data_realizada?: string | null
          endereco?: string | null
          id?: string
          instalador_id?: string | null
          observacoes?: string | null
          os_id?: string
          status?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "entregas_instalacoes_instalador_id_fkey"
            columns: ["instalador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entregas_instalacoes_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
        ]
      }
      itens_os: {
        Row: {
          created_at: string
          custo_unitario: number
          descricao: string
          id: string
          ordem: number
          os_id: string
          quantidade: number
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          custo_unitario?: number
          descricao: string
          id?: string
          ordem?: number
          os_id: string
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          created_at?: string
          custo_unitario?: number
          descricao?: string
          id?: string
          ordem?: number
          os_id?: string
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "itens_os_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
        ]
      }
      logs_auditoria: {
        Row: {
          acao: string
          created_at: string
          detalhes: Json | null
          entidade: string
          entidade_id: string | null
          id: string
          usuario_id: string | null
        }
        Insert: {
          acao: string
          created_at?: string
          detalhes?: Json | null
          entidade: string
          entidade_id?: string | null
          id?: string
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          created_at?: string
          detalhes?: Json | null
          entidade?: string
          entidade_id?: string | null
          id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "logs_auditoria_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      maquinas: {
        Row: {
          ativa: boolean
          created_at: string
          id: string
          nome: string
          tipo: string | null
        }
        Insert: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome: string
          tipo?: string | null
        }
        Update: {
          ativa?: boolean
          created_at?: string
          id?: string
          nome?: string
          tipo?: string | null
        }
        Relationships: []
      }
      materiais: {
        Row: {
          created_at: string
          custo_unitario: number | null
          estoque: number
          id: string
          nome: string
          unidade: string

          fornecedor: string | null
          custo_medio: number | null
          estoque_minimo: number
          estoque_maximo: number | null
          localizacao: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo_unitario?: number | null
          estoque?: number
          id?: string
          nome: string
          unidade?: string

          fornecedor?: string | null
          custo_medio?: number | null
          estoque_minimo?: number
          estoque_maximo?: number | null
          localizacao?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo_unitario?: number | null
          estoque?: number
          id?: string
          nome?: string
          unidade?: string

          fornecedor?: string | null
          custo_medio?: number | null
          estoque_minimo?: number
          estoque_maximo?: number | null
          localizacao?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      os_materiais_obrigatorios: {
        Row: {
          created_at: string
          id: string
          material_id: string
          os_id: string
          quantidade: number
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          os_id: string
          quantidade: number
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          os_id?: string
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "os_materiais_obrigatorios_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "os_materiais_obrigatorios_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
        ]
      }
      movimentacoes_estoque: {
        Row: {
          created_at: string
          id: string
          material_id: string
          observacao: string | null
          os_id: string | null
          quantidade: number
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          observacao?: string | null
          os_id?: string | null
          quantidade: number
          tipo: string
          usuario_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          observacao?: string | null
          os_id?: string | null
          quantidade?: number
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentacoes_estoque_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "materiais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentacoes_estoque_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ocorrencias: {
        Row: {
          created_at: string
          descricao: string
          id: string
          os_id: string
          registrado_por: string | null
          resolvida: boolean
          tipo: string
        }
        Insert: {
          created_at?: string
          descricao: string
          id?: string
          os_id: string
          registrado_por?: string | null
          resolvida?: boolean
          tipo: string
        }
        Update: {
          created_at?: string
          descricao?: string
          id?: string
          os_id?: string
          registrado_por?: string | null
          resolvida?: boolean
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ocorrencias_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ocorrencias_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamento_itens: {
        Row: {
          created_at: string
          custo_unitario: number
          descricao: string
          id: string
          orcamento_id: string
          ordem: number
          quantidade: number
          unidade: string
          valor_total: number
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          custo_unitario?: number
          descricao: string
          id?: string
          orcamento_id: string
          ordem?: number
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Update: {
          created_at?: string
          custo_unitario?: number
          descricao?: string
          id?: string
          orcamento_id?: string
          ordem?: number
          quantidade?: number
          unidade?: string
          valor_total?: number
          valor_unitario?: number
        }
        Relationships: [
          {
            foreignKeyName: "orcamento_itens_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          aprovado_em: string | null
          cliente_id: string
          created_at: string
          created_by: string | null
          custo_estimado: number
          desconto_percentual: number
          descricao: string | null
          enviado_em: string | null
          id: string
          margem_estimada: number | null
          numero: number
          observacoes: string | null
          os_id: string | null
          status: Database["public"]["Enums"]["status_orcamento"]
          titulo: string
          updated_at: string
          validade_dias: number
          valor_subtotal: number
          valor_total: number
          vendedor_id: string | null
        }
        Insert: {
          aprovado_em?: string | null
          cliente_id: string
          created_at?: string
          created_by?: string | null
          custo_estimado?: number
          desconto_percentual?: number
          descricao?: string | null
          enviado_em?: string | null
          id?: string
          margem_estimada?: number | null
          numero?: number
          observacoes?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["status_orcamento"]
          titulo: string
          updated_at?: string
          validade_dias?: number
          valor_subtotal?: number
          valor_total?: number
          vendedor_id?: string | null
        }
        Update: {
          aprovado_em?: string | null
          cliente_id?: string
          created_at?: string
          created_by?: string | null
          custo_estimado?: number
          desconto_percentual?: number
          descricao?: string | null
          enviado_em?: string | null
          id?: string
          margem_estimada?: number | null
          numero?: number
          observacoes?: string | null
          os_id?: string | null
          status?: Database["public"]["Enums"]["status_orcamento"]
          titulo?: string
          updated_at?: string
          validade_dias?: number
          valor_subtotal?: number
          valor_total?: number
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orcamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_os_fk"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orcamentos_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ordens_servico: {
        Row: {
          briefing: string | null
          cliente_id: string
          created_at: string
          created_by: string | null
          custo_previsto: number
          custo_real: number
          data_entrega_real: string | null
          designer_id: string | null
          id: string
          margem_real: number | null
          maquina_id: string | null
          numero: number
          observacoes: string | null
          operador_id: string | null
          orcamento_id: string | null
          ordem_kanban: number
          produto_id: string | null
          prazo_entrega: string | null
          prioridade: number
          responsavel_id: string | null
          setor_atual: string | null
          status: Database["public"]["Enums"]["status_os"]
          titulo: string
          updated_at: string
          valor_total: number
          vendedor_id: string | null

          numero_os: number | null
          contato_id: string | null
          status_financeiro: Database["public"]["Enums"]["status_pagamento"]
          status_arte: string
          status_producao: string
          prazo_cliente: string | null
          prazo_interno: string | null
          valor_venda: number
          lucro_previsto: number
          lucro_real: number
          margem_prevista: number | null
          precisa_entrega: boolean
          precisa_instalacao: boolean
        }
        Insert: {
          briefing?: string | null
          cliente_id: string
          created_at?: string
          created_by?: string | null
          custo_previsto?: number
          custo_real?: number
          data_entrega_real?: string | null
          designer_id?: string | null
          id?: string
          margem_real?: number | null
          maquina_id?: string | null
          numero?: number
          observacoes?: string | null
          operador_id?: string | null
          orcamento_id?: string | null
          ordem_kanban?: number
          produto_id?: string | null
          prazo_entrega?: string | null
          prioridade?: number
          responsavel_id?: string | null
          setor_atual?: string | null
          status?: Database["public"]["Enums"]["status_os"]
          titulo: string
          updated_at?: string
          valor_total?: number
          vendedor_id?: string | null

          numero_os?: number | null
          contato_id?: string | null
          status_financeiro?: Database["public"]["Enums"]["status_pagamento"]
          status_arte?: string
          status_producao?: string
          prazo_cliente?: string | null
          prazo_interno?: string | null
          valor_venda?: number
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          precisa_entrega?: boolean
          precisa_instalacao?: boolean
        }
        Update: {
          briefing?: string | null
          cliente_id?: string
          created_at?: string
          created_by?: string | null
          custo_previsto?: number
          custo_real?: number
          data_entrega_real?: string | null
          designer_id?: string | null
          id?: string
          margem_real?: number | null
          maquina_id?: string | null
          numero?: number
          observacoes?: string | null
          operador_id?: string | null
          orcamento_id?: string | null
          ordem_kanban?: number
          produto_id?: string | null
          prazo_entrega?: string | null
          prioridade?: number
          responsavel_id?: string | null
          setor_atual?: string | null
          status?: Database["public"]["Enums"]["status_os"]
          titulo?: string
          updated_at?: string
          valor_total?: number
          vendedor_id?: string | null

          numero_os?: number | null
          contato_id?: string | null
          status_financeiro?: Database["public"]["Enums"]["status_pagamento"]
          status_arte?: string
          status_producao?: string
          prazo_cliente?: string | null
          prazo_interno?: string | null
          valor_venda?: number
          lucro_previsto?: number
          lucro_real?: number
          margem_prevista?: number | null
          precisa_entrega?: boolean
          precisa_instalacao?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ordens_servico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_designer_id_fkey"
            columns: ["designer_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_operador_id_fkey"
            columns: ["operador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_maquina_id_fkey"
            columns: ["maquina_id"]
            isOneToOne: false
            referencedRelation: "maquinas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_orcamento_id_fkey"
            columns: ["orcamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordens_servico_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos: {
        Row: {
          comprovante_url: string | null
          created_at: string
          data_pagamento: string | null
          data_vencimento: string | null
          forma_pagamento: string | null
          id: string
          observacoes: string | null
          os_id: string
          parcela: number
          registrado_por: string | null
          status: Database["public"]["Enums"]["status_pagamento"]
          total_parcelas: number
          updated_at: string
          valor: number
        }
        Insert: {
          comprovante_url?: string | null
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          os_id: string
          parcela?: number
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["status_pagamento"]
          total_parcelas?: number
          updated_at?: string
          valor: number
        }
        Update: {
          comprovante_url?: string | null
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          forma_pagamento?: string | null
          id?: string
          observacoes?: string | null
          os_id?: string
          parcela?: number
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["status_pagamento"]
          total_parcelas?: number
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          nome: string
          preco_base: number | null

          categoria: string | null
          maquina_padrao_id: string | null
          material_principal_id: string | null
          exigencias: string | null
          margem_minima: number | null
          margem_sugerida: number | null
          preco_minimo: number | null
          preco_sugerido: number | null
          preco_publico: number | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          preco_base?: number | null

          categoria?: string | null
          maquina_padrao_id?: string | null
          material_principal_id?: string | null
          exigencias?: string | null
          margem_minima?: number | null
          margem_sugerida?: number | null
          preco_minimo?: number | null
          preco_sugerido?: number | null
          preco_publico?: number | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          preco_base?: number | null

          categoria?: string | null
          maquina_padrao_id?: string | null
          material_principal_id?: string | null
          exigencias?: string | null
          margem_minima?: number | null
          margem_sugerida?: number | null
          preco_minimo?: number | null
          preco_sugerido?: number | null
          preco_publico?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      tarefas: {
        Row: {
          concluida: boolean
          concluida_em: string | null
          created_at: string
          created_by: string | null
          descricao: string | null
          id: string
          os_id: string
          prazo: string | null
          responsavel_id: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          concluida?: boolean
          concluida_em?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          os_id: string
          prazo?: string | null
          responsavel_id?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          concluida?: boolean
          concluida_em?: string | null
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          os_id?: string
          prazo?: string | null
          responsavel_id?: string | null
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_os_id_fkey"
            columns: ["os_id"]
            isOneToOne: false
            referencedRelation: "ordens_servico"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      usuarios: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email: string
          id: string
          nome: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      avancar_os_status: {
        Args: {
          novo_status: Database["public"]["Enums"]["status_os"]
          os_id: string
        }
        Returns: Database["public"]["Tables"]["ordens_servico"]["Row"]
      }
      can_see_financials: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      status_os_exige_validacoes_producao: {
        Args: { _status: Database["public"]["Enums"]["status_os"] }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "gestor"
        | "financeiro"
        | "vendedor"
        | "designer"
        | "operador"
        | "estoque"
        | "instalador"
        | "cliente"
      canal_aprovacao:
        | "sistema"
        | "whatsapp"
        | "email"
        | "presencial"
        | "telefone"
      status_arquivo: "ativo" | "substituido" | "inativo" | "aprovado" | "rejeitado"
      status_orcamento:
        | "rascunho"
        | "enviado"
        | "aprovado"
        | "rejeitado"
        | "expirado"
        | "convertido"
      status_os:
        | "entrada"
        | "aguardando_briefing"
        | "briefing_ok"
        | "design"
        | "aguardando_aprovacao_arte"
        | "arte_aprovada"
        | "arte_rejeitada"
        | "aguardando_producao"
        | "producao"
        | "em_impressao"
        | "em_corte"
        | "em_acabamento"
        | "em_uv"
        | "em_laser_cnc"
        | "em_3d"
        | "controle_qualidade"
        | "aguardando_retirada"
        | "aguardando_entrega"
        | "em_entrega"
        | "em_instalacao"
        | "concluido"
        | "faturado"
        | "cancelado"
        | "retrabalho"
        | "pausado"
      status_pagamento:
        | "pendente"
        | "parcial"
        | "pago"
        | "atrasado"
        | "cancelado"
      tipo_aprovacao: "arte" | "orcamento"
      tipo_arquivo:
        | "arte"
        | "briefing"
        | "referencia"
        | "producao"
        | "orcamento"
        | "comprovante"
        | "outro"
      tipo_cliente: "pf" | "pj"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "gestor",
        "financeiro",
        "vendedor",
        "designer",
        "operador",
        "estoque",
        "instalador",
        "cliente",
      ],
      canal_aprovacao: [
        "sistema",
        "whatsapp",
        "email",
        "presencial",
        "telefone",
      ],
      status_arquivo: ["ativo", "substituido", "inativo", "aprovado", "rejeitado"],
      status_orcamento: [
        "rascunho",
        "enviado",
        "aprovado",
        "rejeitado",
        "expirado",
        "convertido",
      ],
      status_os: [
        "entrada",
        "aguardando_briefing",
        "briefing_ok",
        "design",
        "aguardando_aprovacao_arte",
        "arte_aprovada",
        "arte_rejeitada",
        "aguardando_producao",
        "producao",
        "em_impressao",
        "em_corte",
        "em_acabamento",
        "em_uv",
        "em_laser_cnc",
        "em_3d",
        "controle_qualidade",
        "aguardando_retirada",
        "aguardando_entrega",
        "em_entrega",
        "em_instalacao",
        "concluido",
        "faturado",
        "cancelado",
        "retrabalho",
        "pausado",
      ],
      status_pagamento: [
        "pendente",
        "parcial",
        "pago",
        "atrasado",
        "cancelado",
      ],
      tipo_aprovacao: ["arte", "orcamento"],
      tipo_arquivo: [
        "arte",
        "briefing",
        "referencia",
        "producao",
        "orcamento",
        "comprovante",
        "outro",
      ],
      tipo_cliente: ["pf", "pj"],
    },
  },
} as const
