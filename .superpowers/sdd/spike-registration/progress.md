# SDD ledger — plan: spike-registration (in-chat plan, Tasks 1-4 + Model B appendix)
Plan mode note: spike, throwaway quality, no tests (manual verification). Spec: in-chat requirements.
Task 1: complete (backend register-trainer endpoint, build succeeded, code=CBS-2026 in appsettings.Development.json, env override Registration__TrainerCode)
Task 2: complete (POST /api/trainees, RequireTrainer policy, AssignedTrainerId from NameIdentifier claim, build succeeded)
Task 3: complete (dashboard/register/{html,css,js}, reuse login.css, login.html footer link)
Task 4: complete (Add Trainee modal: hud-btn, overlay form, toast, JS binds + POST /api/trainees; node --check clean). Note: modal CSS self-contained (login-panel classes restyled locally) since dashboard does not link login.css.
Final review: 1 Important (registration code leaked in register.html placeholder) — fixed, placeholder now 'Enter code'. Minor deferred: (a) unchecked AddToRoleAsync in RegisterTrainer (roleless-user edge), (b) same in CreateTrainee + no user cleanup on failure. Final: fixed placeholder leak
