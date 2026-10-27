#!/bin/bash
# ============================================
# Push InfinityCoder 4.0 to GitHub
# ============================================
# Использование:
#   ./push-to-github.sh <your-username> [repo-name]
#
# Пример:
#   ./push-to-github.sh john_doe InfinityCoder-4.0-ecosystem-fix
# ============================================

set -e

USERNAME="${1:-}"
REPO="${2:-InfinityCoder-4.0-ecosystem-fix}"

if [ -z "$USERNAME" ]; then
    echo "❌ Укажите GitHub username:"
    echo "   ./push-to-github.sh <username> [repo-name]"
    exit 1
fi

REPO_URL="https://github.com/${USERNAME}/${REPO}.git"

echo "=========================================="
echo "  Push to ${REPO_URL}"
echo "=========================================="

# Проверка gh CLI
if command -v gh &> /dev/null; then
    echo "✅ GitHub CLI найден"

    # Создаем репо если не существует
    if ! gh repo view "${USERNAME}/${REPO}" &> /dev/null; then
        echo "📦 Создаю репозиторий ${REPO}..."
        gh repo create "${REPO}" --public --source=. --push || \
            gh repo create "${REPO}" --public
    else
        echo "✅ Репозиторий существует"
    fi

    git remote remove origin 2>/dev/null || true
    git remote add origin "${REPO_URL}"
    git push -u origin master
    echo ""
    echo "✅ Запушено: ${REPO_URL}"

else
    echo "⚠️  GitHub CLI не установлен. Ручной режим:"
    echo ""
    echo "1. Создайте репозиторий на GitHub: https://github.com/new"
    echo "   Имя: ${REPO}"
    echo ""
    echo "2. Выполните команды:"
    echo ""
    echo "   git remote add origin ${REPO_URL}"
    echo "   git branch -M main"
    echo "   git push -u origin main"
    echo ""
    echo "3. Или сгенерируйте токен: https://github.com/settings/tokens"
    echo "   (scopes: repo) и используйте:"
    echo ""
    echo "   git remote add origin https://<TOKEN>@github.com/${USERNAME}/${REPO}.git"
    echo "   git push -u origin main"
fi
