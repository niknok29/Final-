# AI İstifadəsi Haqqında Bəyannamə

Komanda: 3 nəfər. Layihə: Urban Crisis & Crowd Evacuation Engine, Digital Challenge 2026 Azərbaycan final.

## 1. İstifadə olunan alətlər və məsuliyyət bölgüsü

| Komanda üzvü | AI aləti | İstifadə sahəsi |
|---|---|---|
| Nihad | Claude (claude.ai və Claude Code) | Backend, API kontraktı, testlər, yük testi, təhlükəsizlik, Challenge Drop həlləri, arxitektura, təhvil sənədləri |
| Gülbəs | ChatGPT Plus | Vətəndaş veb tətbiqi (citizen-web) |
| Elvin | Gemini Pro (komanda bildirib; jurnalda "AI Coding Assistant" kimi yazılıb) | Dispetçer paneli (dispatcher-web), sənədlər |

## 2. Mərhələlər üzrə istifadə

| Mərhələ | Kim / hansı alət | Nə üçün | Nəticə |
|---|---|---|---|
| Planlaşdırma | Nihad / Claude | Texnologiya seçimi (Python, FastAPI), rolların bölgüsü, kontrakt-əvvəl yanaşma | `docs/API_CONTRACT.md`, hər üzv üçün tapşırıq brifləri |
| Backend | Nihad / Claude Code | API, SQLModel modelləri, Kritik Böhran Alqoritmi, marşrutlaşdırma, WebSocket | İşlək backend, pytest testləri |
| Drop 1 | Nihad / Claude Code; Gülbəs, Elvin / öz agentləri | Prioritet SOS, əlçatan marşrut, AZ/EN | Backend kontrakt genişlənməsi, frontend uyğunlaşması |
| Drop 2 | Nihad / Claude Code; Elvin / Gemini | Circuit breaker, ehtiyat marşrut, oflayn bildiriş | `routing.py`, panel göstəriciləri |
| Drop 3 | Nihad / Claude Code | SOS flood müdafiəsi, JWT/RBAC, gecikmə optimallaşdırması | `flood.py`, `security.py`, `intake.py`, yük testi |
| Frontend | Gülbəs / ChatGPT; Elvin / Gemini | React komponentləri, xəritə, i18n | Vətəndaş və dispetçer interfeysləri |
| Test | Claude Code | Pytest testləri, yük testi skripti | Testlər və yük testi nəticələri |
| Sənədləşdirmə | Claude, Gemini | README, texniki izah, bu bəyannamə | `docs/` qovluğu |

Dəqiq vaxt qeydləri: `docs/AI_USAGE.md`. Dispetçer modulunun jurnalı 12:15-dən 14:35-ə qədər 9 qeyddir: arxitektura, Drop 1 (prioritet SOS, i18n), provayder/circuit breaker interfeysi, metrik xəritə və Haversine, Drop 2 (ehtiyat marşrut banneri), backend sərtləşdirilməsi, Drop 3 (flood bannerı, batching, RBAC interfeysi), xəritə dəqiqliyi. Hər addımda lint və build yoxlanılıb.

## 3. İnsan nəzarəti
- Texnologiya seçimini, rolların bölgüsünü və hər Drop üçün qərarı komanda verdi.
- AI tərəfindən yazılmış kod işə salınıb yoxlanıldı: testlər işə salındı, canlı serverə qarşı real sorğular və WebSocket yoxlamaları aparıldı, yük testi ölçüldü.
- Kod `develop` branch-inə yalnız build və testlər keçəndən sonra daxil edildi.
- AI nəticələrində aşkar edilən problemlər (məsələn, backend ilə frontend arasında uyğunsuzluqlar) komanda tərəfindən aşkarlandı və düzəldildi.

## 4. Məhdudiyyətlər
- Hesabat zamanı AI ilə yaradılmış kodun hamısı üçün müstəqil təhlükəsizlik auditi aparılmayıb.
- AI alətlərinə həssas məlumat (real parollar, açarlar) verilməyib. Layihədəki hesablar yalnız test məqsədlidir.
