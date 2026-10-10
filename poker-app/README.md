# ヘッズアップ・ホールデム

リンクを共有するだけで、2人で遊べるノーリミットテキサスホールデムのトーナメントアプリです。
時間がたつとブラインドが上がり、初期スタック・ブラインド表・レベル時間・持ち時間などは対戦前に設定できます。

要件は [docs/requirements.md](docs/requirements.md) を参照してください。

## 遊び方

1. トップ画面で「部屋を作る」を押し、ニックネームを入れる
2. ロビーに表示されるリンクを相手に送り、対戦の設定を決める
3. 相手がリンクを開いて参加し、「準備OK」を押すと3秒後に開始
4. どちらかのスタックが 0 になるか投了すると試合終了。両者が「リマッチ」を押すと同じ設定でロビーに戻る

リロードしたり通信が切れたりしても、同じ端末・ブラウザでリンクを開き直せば同じ席に戻れます。

## ローカルで動かす

Node.js 20 以上が必要です。

```sh
npm install
npm run dev
```

http://localhost:5173 を開きます。対戦を試すときは、通常ウィンドウとシークレットウィンドウのように、保存領域が別のブラウザを2つ使ってください（同じブラウザの別タブだと同じ席として扱われます）。

## テスト

```sh
npm test            # ゲームエンジンと部屋のロジックの単体テスト（Vitest）
npm run typecheck   # 型チェック
npm run e2e         # 2つのブラウザで1試合を通す E2E テスト（Playwright）
```

E2E テストは開発サーバーを自動で起動します。初回は `npx playwright install chromium` でブラウザを入れてください。

## デプロイ（Cloudflare 無料プラン）

Cloudflare Workers と Durable Objects で動きます。無料プランで動かせます。

1. [Cloudflare](https://dash.cloudflare.com/sign-up) のアカウントを作る
2. ログインする

   ```sh
   npx wrangler login
   ```

3. ビルドしてデプロイする

   ```sh
   npm run deploy
   ```

4. 表示された `https://headsup-poker.<あなたのサブドメイン>.workers.dev` を開く

Worker 名（URL の一部）を変えたいときは、`wrangler.jsonc` の `name` を書き換えてください。

## 構成

```
src/
  engine/   ゲームエンジン（通信・UI から独立した純粋な TypeScript）
            cards.ts      デッキ・暗号論的乱数によるシャッフル
            evaluator.ts  役判定
            hand.ts       1ハンドの進行（ブラインド、ベッティング、ポット、ショーダウン）
            settings.ts   設定・プリセット・入力チェック・レベル計算
            clock.ts      一時停止できるゲーム時計
  server/   部屋のロジック（RoomCore）と、プレイヤーごとの情報の絞り込み
  worker/   Cloudflare Worker と Durable Object（WebSocket・保存・アラーム）
  shared/   クライアントとサーバーのメッセージ型
  client/   React の画面
e2e/        Playwright のテスト
```

- 1部屋 = 1 Durable Object。シャッフルと判定はすべてサーバーで行い、相手の手札はブラウザに送りません。
- タイマー（持ち時間・ランアウト・次のハンド・開始/再開のカウントダウン・部屋の期限切れ）は Durable Object のアラームで動きます。
- 部屋のデータは、最後の接続から24時間で削除されます。
