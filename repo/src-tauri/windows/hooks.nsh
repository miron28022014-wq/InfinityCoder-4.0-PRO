; InfinityCoder NSIS hooks.
; After install we create the model directory and offer to fetch the local model.

!include "LogicLib.nsh"

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "InfinityCoder 3.0"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Подготовка папки моделей..."
  CreateDirectory "$APPDATA\com.miron.infinitycoder"
  CreateDirectory "$APPDATA\com.miron.infinitycoder\models"

  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" model_ready

  ; Ask first — a 5 GB download must never happen without consent.
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "Скачать локальную модель Qwen2.5-Coder-7B (~5 ГБ)?$n$\
Если пропустить, InfinityCoder будет работать только с облачным провайдером." \
    IDNO skip_model

  DetailPrint "Загрузка Qwen2.5-Coder-7B Q4_K_M (~5 ГБ)..."
  DetailPrint "Это может занять несколько минут. Не закрывайте установщик."

  ClearErrors
  ExecWait '"$SYSDIR\curl.exe" --location --fail --retry 5 --retry-all-errors --continue-at - --output "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "https://huggingface.co/second-state/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf?download=true"' $0

  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Не удалось скачать модель.$n$\
InfinityCoder установлен, но локальный режим не заработает до скачивания.$n$\
Модель всегда можно скачать позже вручную в:$n$\
$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
    Goto done
  ${EndIf}

  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" 0 download_failed
  Rename "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf.part" "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  IfFileExists "$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf" 0 download_failed
  Goto model_ready

download_failed:
  MessageBox MB_ICONSTOP "Загрузка модели не завершилась.$n$\
InfinityCoder установлен. Скачайте модель позже и положите в:$n$\
$APPDATA\com.miron.infinitycoder\models\qwen-coder.gguf"
  Goto done

skip_model:
  DetailPrint "Загрузка модели пропущена — доступен облачный режим."
  Goto done

model_ready:
  DetailPrint "Модель готова."

done:
!macroend
