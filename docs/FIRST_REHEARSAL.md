# Primeiro ensaio real — convites individuais, agenda semanal e mural do ensaio

## Convites individuais (um link por músico)

- `POST /api/bands/:bandId/personal-invites` (somente administradores): nome do músico, instrumento
  previsto, instrumentos secundários, papel e validade (padrão 7 dias). Responde **uma única vez** com
  o link `/convite/<token>`; o token tem 256 bits aleatórios e só o seu SHA-256 é guardado
  (`band_invitations.code = "pi_" + sha256`). Listar (`GET`) e revogar (`DELETE …/:id`) também.
- `GET /api/personal-invites/:token` — o que a pessoa convidada vê (banda, nome previsto, instrumento,
  papel). Nada sobre outros integrantes.
- `POST /api/personal-invites/:token/register` — cria a conta da pessoa (e-mail e senha dela) e entra
  na banda no mesmo passo. E-mail já cadastrado → `email_in_use` (sem contas duplicadas).
- `POST /api/personal-invites/:token/accept` — quem já tem conta (e está conectado) usa o convite.
- Uso único: um `UPDATE … WHERE uses < max_uses` é a trava (dois acessos simultâneos → só um entra).
  Expiração, revogação e "já usado" têm códigos próprios. Papel e instrumento vêm do convite, nunca
  da tela. Nenhuma conta é criada antes da aceitação.
- `grants_ownership`: o convite do responsável transfere a banda para quem o aceitar (usado quando a
  banda é preparada para alguém que ainda não tem conta). Ver `scripts/setup-band.mjs`.

### Homologação: o link é a própria chave do portão

O portão da homologação (`bs_access`) continua valendo para tudo. Um link `/convite/<token>` válido
(ativo, ou já aceito — para a mesma pessoa voltar em outro aparelho) abre o portão como se a chave
tivesse sido digitada; link inventado, revogado ou expirado não abre. Dados continuam atrás do login
e da participação na banda. Limite de 30 tentativas por IP a cada 15 minutos.

## Agenda: ensaio semanal

- `rehearsal_schedules`: regra (dia da semana, horário de parede `HH:MM`, fuso IANA, data inicial,
  duração/local/observações opcionais). Não se cria uma lista ilimitada de datas: as próximas 4
  ocorrências viram linhas de `events` (tipo `rehearsal`) quando a agenda é consultada
  (`series_date` + índice único evitam duplicatas).
- Horário guardado como instante UTC calculado **por data** a partir do horário de parede e do fuso
  (`packages/shared/src/time/zoned.ts`): terça 19:00 em São Paulo = 22:00 UTC.
- Editar uma ocorrência (`PATCH …/agenda/occurrences/:id`) a marca como `detached`; editar a série
  (`PATCH …/agenda/schedules/:id`) atualiza as futuras não alteradas. Se o dia da semana mudar, as
  futuras sem atividade (comentários, presenças, sessão) são refeitas; as com atividade ficam.
- Sem horário de término: o ensaio continua "atual" por 6 h depois do início; nada é encerrado
  automaticamente por horário.

## Presença

`PUT …/agenda/occurrences/:id/attendance` com `confirmed | declined | pending` (tabela existente
`event_attendance`). Cada um responde por si; independe de entrar no Ensaio Live.

## Mural do ensaio

- `rehearsal_comments` por ocorrência; opcionalmente ligado a uma música da banda.
- `GET/POST …/comments`, `PATCH …/comments/:id` (só o autor), `DELETE …/comments/:id` (autor ou
  administrador; oculta, não apaga). Tudo verificado no servidor.
- Antes, durante e depois: encerrar a sessão ao vivo não fecha o mural.
- Tempo real por consulta a cada 4 s enquanto o mural está na tela (simples e robusto; push pelo
  WebSocket do ensaio fica como refinamento).
- No Ensaio Live: botão "Mural do ensaio" no topo (abre um painel); na tela "Ensaio encerrado",
  atalho para o mural. Na página do ensaio: presença, entrada no Ensaio Live e o mural.

## Sessão ao vivo ligada ao ensaio

`rehearsal_sessions.event_id`. `POST …/agenda/occurrences/:id/session` abre (ou reaproveita) a sessão
do ensaio; uma sessão aberta pelo lobby durante um ensaio da agenda também é ligada a ele. Nada toca
sozinho; a regência segue o protocolo existente (primeiro com permissão que conecta; administrador ou
integrante autorizado pode assumir).

## Preparar uma banda real na homologação

`scripts/setup-band.mjs <config.json>` — banda, série semanal, primeira ocorrência, convites e (opcional)
cópia das músicas de outra banda, incluindo arquivos de áudio copiados no R2 sob a nova banda. A banda
de origem só é lida. Cria um usuário técnico de configuração que **não consegue entrar** (sem senha
válida) e nunca é integrante; a banda passa para o responsável quando ele aceita o próprio convite.
`SETUP_LOCAL=1` ensaia tudo no banco local. Os links ficam em `.staging/<banda>-invites.json`
(ignorado pelo git).
