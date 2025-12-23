# 開発引き継ぎメモ

## 現在の状態
- Hardhat コントラクト環境（`contracts/`）と Next.js/Tailwind フロント（`web/`）を同一リポジトリにセットアップ済み。
- `npx hardhat compile` および `npm run lint` は成功確認済み。
- 作業ディレクトリは WSL2 ext4 (`/home/jinjinsansan/defi`) に移行済みで、このディレクトリを正とする。

## 直近のタスク状況
1. **Step 1 (リポジトリ初期化＆環境構築)** 完了。
2. **Step 2 (スマートコントラクト下準備)** は未着手。OpenZeppelin 導入や権限管理の実装から着手予定。

## 既知の課題 / ブロッカー
- `npx hardhat test` が WSL2 上で `Bus error (core dumped)` になる。`dmesg` には Node プロセスの SIGBUS が記録されており、WSL2 + Linux カーネルの既知不具合と推測。
- `/mnt/e` → `/home` への移動、Node 18/20/22 切り替え、`HARDHAT_MAX_WORKERS=1` 等を試しても改善せず。
- **対処済みワークアラウンド**:
  - Windows 側で `wsl --update && wsl --shutdown` を実施しても根本解消しない場合は、Docker 経由でテストを実行する。
  - リポジトリ直下に `docker-compose.yml` と `docker/hardhat.Dockerfile` を追加済み。以下のコマンドで依存関係インストール→Hardhat テスト実行まで自動化。

```bash
cd /home/jinjinsansan/defi
docker compose run --rm hardhat
```

- 初回実行時に `contracts/node_modules` が空の場合でも、コンテナ内で `npm ci` が走るため追加の手作業は不要。

## 次にやること
1. WSL 更新または Docker 環境で `npx hardhat test` が通る状態を確保する。
2. Step 2 の実装方針（OpenZeppelin、マルチシグ、Pause 機構）を決定し、ブランチを切って着手。
3. Supabase/Render/Vercel 向けのインフラ設定テンプレートを追加（必要に応じて）。

## 参考コマンド
```bash
# Hardhat
cd /home/jinjinsansan/defi/contracts
npm install
npx hardhat compile
npx hardhat test   # ← WSL2 では SIGBUS になるため、Docker で `docker compose run --rm hardhat` を推奨。

# Next.js
cd /home/jinjinsansan/defi/web
npm install
npm run dev
npm run lint
```

## 連絡事項
- `.env` は `contracts/.env` に配置される想定（Git 管理外）。
- GitHub リポジトリ: https://github.com/jinjinsansan/defi （これから push 済みにする予定）。
