-- Demo data for local development ONLY. Everything here is fictional: the songs, lyrics and
-- chord charts were written for this seed and are free to use. Never run against production.
-- All demo accounts share the password: bandsync-demo

INSERT OR IGNORE INTO users (id, email, password_hash, display_name, primary_instrument, secondary_instruments, created_at, updated_at) VALUES
  ('demo-user-ana',   'ana@bandsync.demo',   'pbkdf2$sha256$100000$I9vCpHoEIz4qaSkixP9HhQ$tG2Qh0FLIEBnZrjmWpgGitOJ0xx7Iw-XUJ0OQX6Y7no', 'Ana Ribeiro',   'drums',  '[]', '2026-01-10T12:00:00.000Z', '2026-01-10T12:00:00.000Z'),
  ('demo-user-bruno', 'bruno@bandsync.demo', 'pbkdf2$sha256$100000$I9vCpHoEIz4qaSkixP9HhQ$tG2Qh0FLIEBnZrjmWpgGitOJ0xx7Iw-XUJ0OQX6Y7no', 'Bruno Costa',   'bass',   '["guitar"]', '2026-01-10T12:00:00.000Z', '2026-01-10T12:00:00.000Z'),
  ('demo-user-carla', 'carla@bandsync.demo', 'pbkdf2$sha256$100000$I9vCpHoEIz4qaSkixP9HhQ$tG2Qh0FLIEBnZrjmWpgGitOJ0xx7Iw-XUJ0OQX6Y7no', 'Carla Mendes',  'vocals', '["keys"]', '2026-01-10T12:00:00.000Z', '2026-01-10T12:00:00.000Z'),
  ('demo-user-diego', 'diego@bandsync.demo', 'pbkdf2$sha256$100000$I9vCpHoEIz4qaSkixP9HhQ$tG2Qh0FLIEBnZrjmWpgGitOJ0xx7Iw-XUJ0OQX6Y7no', 'Diego Alves',   'guitar', '[]', '2026-01-10T12:00:00.000Z', '2026-01-10T12:00:00.000Z');

INSERT OR IGNORE INTO user_preferences (user_id, locale, theme, notation, material_preferences, click_sound, click_volume, updated_at) VALUES
  ('demo-user-ana',   'pt-BR', 'dark',   'latin',   '{}', 'wood', 0.9, '2026-01-10T12:00:00.000Z'),
  ('demo-user-bruno', 'pt-BR', 'system', 'english', '{"bass":["bass_tab","chords"]}', 'beep', 0.8, '2026-01-10T12:00:00.000Z'),
  ('demo-user-carla', 'en',    'light',  'english', '{}', 'tick', 0.6, '2026-01-10T12:00:00.000Z'),
  ('demo-user-diego', 'en',    'dark',   'english', '{"guitar":["guitar_tab","chords"]}', 'beep', 0.8, '2026-01-10T12:00:00.000Z');

INSERT OR IGNORE INTO bands (id, name, description, genre, created_by, created_at, updated_at) VALUES
  ('demo-band', 'Sala 3', 'Banda de demonstração do BandSync. Ensaio às quintas.', 'indie rock', 'demo-user-ana', '2026-01-10T12:05:00.000Z', '2026-01-10T12:05:00.000Z');

INSERT OR IGNORE INTO band_members (band_id, user_id, role, instrument, can_edit_repertoire, can_manage_events, can_control_rehearsal, can_post_announcements, joined_at) VALUES
  ('demo-band', 'demo-user-ana',   'admin',  'drums',  1, 1, 1, 1, '2026-01-10T12:05:00.000Z'),
  ('demo-band', 'demo-user-bruno', 'member', 'bass',   1, 0, 1, 1, '2026-01-10T12:10:00.000Z'),
  ('demo-band', 'demo-user-carla', 'member', 'vocals', 1, 0, 0, 1, '2026-01-10T12:12:00.000Z'),
  ('demo-band', 'demo-user-diego', 'member', 'guitar', 0, 0, 1, 1, '2026-01-10T12:15:00.000Z');

-- Song 1: "Luz da Garagem" (fictional)
INSERT OR IGNORE INTO songs (id, band_id, title, artist, original_bpm, original_key, duration_seconds, created_by, created_at, updated_at) VALUES
  ('demo-song-1', 'demo-band', 'Luz da Garagem', 'Sala 3', 128, 'D', 214, 'demo-user-ana', '2026-01-11T10:00:00.000Z', '2026-01-11T10:00:00.000Z');
INSERT OR IGNORE INTO song_versions (id, song_id, label, bpm, key, beats_per_bar, beat_unit, notes, is_current, created_at, updated_at) VALUES
  ('demo-ver-1', 'demo-song-1', 'band', 120, 'C', 4, 4, 'Tocamos um tom abaixo da gravação. Parada seca no fim do segundo refrão.', 1, '2026-01-11T10:00:00.000Z', '2026-01-11T10:00:00.000Z');
INSERT OR IGNORE INTO song_sections (id, version_id, name, position, bars, notes) VALUES
  ('demo-sec-1a', 'demo-ver-1', 'Intro', 0, 4, 'Só bateria e baixo'),
  ('demo-sec-1b', 'demo-ver-1', 'Verso', 1, 8, NULL),
  ('demo-sec-1c', 'demo-ver-1', 'Refrão', 2, 8, NULL),
  ('demo-sec-1d', 'demo-ver-1', 'Verso', 3, 8, NULL),
  ('demo-sec-1e', 'demo-ver-1', 'Refrão', 4, 8, 'Parada seca no último tempo'),
  ('demo-sec-1f', 'demo-ver-1', 'Solo', 5, 8, 'Guitarra'),
  ('demo-sec-1g', 'demo-ver-1', 'Refrão final', 6, 8, NULL),
  ('demo-sec-1h', 'demo-ver-1', 'Final', 7, 2, 'Acorde longo');
INSERT OR IGNORE INTO song_materials (id, song_id, version_id, type, title, instrument, body, key, version, created_by, created_at, updated_at) VALUES
  ('demo-mat-1-lyrics', 'demo-song-1', 'demo-ver-1', 'lyrics', 'Letra', NULL,
'Luz da garagem acesa até tarde
Cabos no chão, café que esfriou
A gente afina o que a semana desafina
E a rua inteira escuta o que sobrou

Deixa o relógio correr sozinho
Hoje a contagem é só quatro no ar
Quando a bateria chama, a gente vem
E a garagem vira o nosso lugar', NULL, 1, 'demo-user-carla', '2026-01-11T10:05:00.000Z', '2026-01-11T10:05:00.000Z'),
  ('demo-mat-1-chords', 'demo-song-1', 'demo-ver-1', 'chords', 'Cifra', NULL,
'[Intro] C  G  Am  F  (2x)

C                G
Luz da garagem acesa até tarde
Am               F
Cabos no chão, café que esfriou
C                   G
A gente afina o que a semana desafina
Am                 F        G
E a rua inteira escuta o que sobrou

[Refrão]
F        G         C
Deixa o relógio correr sozinho
F        G          Am
Hoje a contagem é só quatro no ar
F          G        C      Am
Quando a bateria chama, a gente vem
F        G           C
E a garagem vira o nosso lugar', 'C', 1, 'demo-user-diego', '2026-01-11T10:06:00.000Z', '2026-01-11T10:06:00.000Z'),
  ('demo-mat-1-bass', 'demo-song-1', 'demo-ver-1', 'bass_tab', 'Linha de baixo', 'bass',
'Intro / Verso (C  G  Am  F)
G|---------------------------------|
D|---------------------------------|
A|-3-3-3-3-------------0-0-0-0-----|
E|---------3-3-3-3-------------1-1-|

Refrão: colcheias, segue a cifra. Parada seca no último tempo do 2º refrão.', NULL, 1, 'demo-user-bruno', '2026-01-11T10:07:00.000Z', '2026-01-11T10:07:00.000Z'),
  ('demo-mat-1-drums', 'demo-song-1', 'demo-ver-1', 'drum_map', 'Mapa de bateria', 'drums',
'Intro (4)      : bumbo em 1 e 3, chimbal fechado, virada no 4º compasso
Verso (8)      : groove básico, aro no 2 e 4
Refrão (8)     : condução no prato, caixa aberta
Verso (8)      : volta ao aro
Refrão (8)     : PARADA SECA no último tempo!
Solo (8)       : groove pesado, crash a cada 2 compassos
Refrão final(8): condução no ride
Final (2)      : acorde longo, crash no 1', NULL, 1, 'demo-user-ana', '2026-01-11T10:08:00.000Z', '2026-01-11T10:08:00.000Z'),
  ('demo-mat-1-gtab', 'demo-song-1', 'demo-ver-1', 'guitar_tab', 'Riff do solo', 'guitar',
'Solo (8 compassos) - tom de C
e|-----------------8-10-12-10-8-----------------|
B|--8-10-12-10-8---------------------8-10-12----|
G|----------------------------------------------|
D|----------------------------------------------|
A|----------------------------------------------|
E|----------------------------------------------|', NULL, 1, 'demo-user-diego', '2026-01-11T10:09:00.000Z', '2026-01-11T10:09:00.000Z');

-- Song 2: "Quinta às Oito" (fictional, waltz)
INSERT OR IGNORE INTO songs (id, band_id, title, artist, original_bpm, original_key, duration_seconds, created_by, created_at, updated_at) VALUES
  ('demo-song-2', 'demo-band', 'Quinta às Oito', 'Sala 3', 92, 'G', 185, 'demo-user-ana', '2026-01-12T10:00:00.000Z', '2026-01-12T10:00:00.000Z');
INSERT OR IGNORE INTO song_versions (id, song_id, label, bpm, key, beats_per_bar, beat_unit, notes, is_current, created_at, updated_at) VALUES
  ('demo-ver-2', 'demo-song-2', 'band', 92, 'G', 3, 4, 'Valsa. Entrada só com voz e teclado.', 1, '2026-01-12T10:00:00.000Z', '2026-01-12T10:00:00.000Z');
INSERT OR IGNORE INTO song_sections (id, version_id, name, position, bars, notes) VALUES
  ('demo-sec-2a', 'demo-ver-2', 'Intro', 0, 8, 'Voz e teclado'),
  ('demo-sec-2b', 'demo-ver-2', 'Verso', 1, 16, 'Entra a banda'),
  ('demo-sec-2c', 'demo-ver-2', 'Refrão', 2, 16, NULL),
  ('demo-sec-2d', 'demo-ver-2', 'Final', 3, 4, 'Rallentando');
INSERT OR IGNORE INTO song_materials (id, song_id, version_id, type, title, instrument, body, key, version, created_by, created_at, updated_at) VALUES
  ('demo-mat-2-chords', 'demo-song-2', 'demo-ver-2', 'chords', 'Cifra', NULL,
'G        D/F#     Em      C
Quinta às oito a porta range
G          D        C      D
Alguém já chegou e ligou o amplificador
G        D/F#     Em      C
O chão lembra todos os ensaios
G       D       C   D   G
E a semana enfim encontra o seu lugar', 'G', 1, 'demo-user-diego', '2026-01-12T10:05:00.000Z', '2026-01-12T10:05:00.000Z'),
  ('demo-mat-2-lyrics', 'demo-song-2', 'demo-ver-2', 'lyrics', 'Letra', NULL,
'Quinta às oito a porta range
Alguém já chegou e ligou o amplificador
O chão lembra todos os ensaios
E a semana enfim encontra o seu lugar', NULL, 1, 'demo-user-carla', '2026-01-12T10:06:00.000Z', '2026-01-12T10:06:00.000Z'),
  ('demo-mat-2-arr', 'demo-song-2', 'demo-ver-2', 'arrangement_map', 'Mapa de arranjo', NULL,
'| Intro 8 | Verso 16 | Refrão 16 | Verso 16 | Refrão 16 | Final 4 (rall.) |
Entrada: voz + teclado. Banda entra no verso. Baixo em semínimas no refrão.', NULL, 1, 'demo-user-ana', '2026-01-12T10:07:00.000Z', '2026-01-12T10:07:00.000Z');

-- Song 3: "Contagem Regressiva" (fictional, fast)
INSERT OR IGNORE INTO songs (id, band_id, title, artist, original_bpm, original_key, duration_seconds, created_by, created_at, updated_at) VALUES
  ('demo-song-3', 'demo-band', 'Contagem Regressiva', 'Sala 3', 160, 'E', 150, 'demo-user-bruno', '2026-01-13T10:00:00.000Z', '2026-01-13T10:00:00.000Z');
INSERT OR IGNORE INTO song_versions (id, song_id, label, bpm, key, beats_per_bar, beat_unit, notes, is_current, created_at, updated_at) VALUES
  ('demo-ver-3', 'demo-song-3', 'band', 156, 'E', 4, 4, 'Um pouco mais lenta que a referência até todo mundo pegar.', 1, '2026-01-13T10:00:00.000Z', '2026-01-13T10:00:00.000Z');
INSERT OR IGNORE INTO song_materials (id, song_id, version_id, type, title, instrument, body, key, version, created_by, created_at, updated_at) VALUES
  ('demo-mat-3-chords', 'demo-song-3', 'demo-ver-3', 'chords', 'Cifra', NULL,
'[Intro] E5  A5  B5  A5

E5              A5
Dez, nove, oito, sete, seis
B5              A5
Ninguém olha pro relógio
E5              A5
Cinco, quatro, três, dois, um
B5              A5         E5
E a garagem vira palco', 'E', 1, 'demo-user-diego', '2026-01-13T10:05:00.000Z', '2026-01-13T10:05:00.000Z'),
  ('demo-mat-3-bass', 'demo-song-3', 'demo-ver-3', 'bass_tab', 'Baixo', 'bass',
'Pedal em E (colcheias) nos versos. Refrão segue as fundamentais: E5 A5 B5 A5.
G|-----------------|
D|-----------------|
A|-------------2---|
E|-0-0-0-0-0-0---0-|', NULL, 1, 'demo-user-bruno', '2026-01-13T10:06:00.000Z', '2026-01-13T10:06:00.000Z'),
  ('demo-mat-3-drums', 'demo-song-3', 'demo-ver-3', 'drum_map', 'Bateria', 'drums',
'Intro: 4 compassos só caixa (contagem). Verso: punk beat. Refrão: crash em todo 1.', NULL, 1, 'demo-user-ana', '2026-01-13T10:07:00.000Z', '2026-01-13T10:07:00.000Z');

INSERT OR IGNORE INTO repertoires (id, band_id, name, kind, description, created_by, created_at, updated_at) VALUES
  ('demo-rep-rehearsal', 'demo-band', 'Ensaio de quinta', 'rehearsal', 'Ordem do próximo ensaio', 'demo-user-ana', '2026-01-14T10:00:00.000Z', '2026-01-14T10:00:00.000Z'),
  ('demo-rep-show', 'demo-band', 'Show do bar', 'setlist', NULL, 'demo-user-ana', '2026-01-14T10:00:00.000Z', '2026-01-14T10:00:00.000Z');
INSERT OR IGNORE INTO repertoire_items (id, repertoire_id, song_id, position, notes) VALUES
  ('demo-item-1', 'demo-rep-rehearsal', 'demo-song-1', 0, NULL),
  ('demo-item-2', 'demo-rep-rehearsal', 'demo-song-2', 1, 'Repetir a entrada'),
  ('demo-item-3', 'demo-rep-rehearsal', 'demo-song-3', 2, NULL),
  ('demo-item-4', 'demo-rep-show', 'demo-song-3', 0, 'Abertura'),
  ('demo-item-5', 'demo-rep-show', 'demo-song-1', 1, NULL);
