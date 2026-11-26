"use client";
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { definirPersonaHumana } from '@/app/actions/settings/definirPersonaHumana';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { traduzir } from '@/lib/i18n/dicionario';
import type { Idioma } from '@/lib/i18n/idiomas';

/** Interruptor da persona humana (`lib/agent-engine/persona-humana.ts`). Salva no clique. */
export function PersonaHumana({ ligada, podeMudar, idioma }: { ligada: boolean; podeMudar: boolean; idioma: Idioma }) {
  const [valor, setValor] = useState(ligada);
  const [pendente, startTransition] = useTransition();
  const router = useRouter();
  const t = (texto: string) => traduzir(texto, idioma);
  return <Card className="p-6">
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="persona_humana">{t('Persona humana')}</Label>
        <p className="max-w-2xl text-xs text-muted-foreground">{t('O agente se apresenta como uma pessoa da equipe e não revela que é IA, nem quando o cliente pergunta. O nome e a apresentação continuam vindo das instruções de cada agente. O pedido para falar com um atendente, a parada de quem não quer mais mensagens e a proteção de dados sensíveis continuam iguais. Vem desligada.')}</p>
        <p className="text-xs" data-testid="persona-humana-estado">{valor ? t('Ligado: o agente fala como uma pessoa da equipe.') : t('Desligado: se o cliente perguntar, o agente diz que é um assistente.')}</p>
        {!podeMudar && <p className="text-xs text-muted-foreground">{t('Só um administrador da organização pode mudar esta opção.')}</p>}
      </div>
      <Switch id="persona_humana" checked={valor} disabled={pendente || !podeMudar}
        onCheckedChange={(novo) => startTransition(async () => {
          const r = await definirPersonaHumana(novo);
          if (!r.ok) { toast.error(t(r.error ?? 'Não foi possível salvar.')); return; }
          setValor(novo); toast.success(t('Opção salva.')); router.refresh();
        })} />
    </div>
  </Card>;
}
