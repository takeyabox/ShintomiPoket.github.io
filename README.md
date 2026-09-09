# Shintomi Poket

オリジナルポケモン6体による、6体見せ合い・3体選出のオンラインシングルバトルです。静的ファイルはGitHub Pagesで配信でき、ルーム、対戦状態、プレイヤーごとの編成はFirebase Realtime Databaseで同期します。

## Firebaseの準備

GitHub Pagesへの公開はHTML・JavaScript・CSSを配信するだけで、Firebase Authenticationの有効化やRealtime Databaseルールの反映は行いません。次のFirebase側設定を別途行ってください。

1. Firebase Consoleでウェブアプリを作成します。
2. Authenticationを開いて「始める」を完了し、「ログイン方法」で「匿名」ログインを有効にします。
3. Authenticationの「設定」>「承認済みドメイン」に `takeyabox.github.io` を追加します。
4. Realtime Databaseを作成します。
5. `database.rules.json` のルールをRealtime Databaseへ反映します。Firebase CLIを使う場合は、プロジェクトのルートで `firebase deploy --only database` を実行します。
6. ゲームのログイン画面に `apiKey`、`authDomain`、`projectId`、`databaseURL`、`appId` を入力します。設定をリポジトリに含めたい場合は `firebase-config.js` へ同じ値を記入します。

Firebaseのウェブ設定値はクライアント識別用であり、秘密鍵ではありません。課金上限、App Check、利用ドメイン制限もFirebase Console側で設定してください。

## 編成のクラウド保存

オンラインログインすると、正規化したプレイヤー名をキーに `playerProfiles` から編成を自動ロードします。画面上部の「セーブ」「ロード」はどの画面からでも利用でき、「編成を保存して次へ」でもFirebaseへ保存します。ロードした編成はローカルにも控えとして保存され、対戦開始前なら入室中の部屋にも反映されます。進行中の対戦には影響せず、次回の対戦から使用されます。

このプロジェクトでは要件どおりプレイヤー名だけをIDとしているため、同じ名前を入力した端末は同じ編成スロットを読み書きできます。プレイヤー名は秘密情報や本人確認には使えません。本番で本人だけに編集を限定する場合は、匿名認証ではなく恒久アカウント認証を追加してください。

## GitHub Pagesで接続できない場合

- `auth/configuration-not-found`: Firebase ConsoleでAuthenticationの初期設定が完了していません。「Authentication > 始める」を完了してから匿名ログインを有効にします。
- `auth/operation-not-allowed`: 匿名ログインが無効です。「Authentication > ログイン方法」で有効にします。
- `auth/unauthorized-domain`: 「Authentication > 設定 > 承認済みドメイン」に `takeyabox.github.io` を追加します。
- 入力欄が空または古い: Firebase接続設定内の「保存済み設定を消して公開設定に戻す」を押します。GitHub PagesとLive Serverは別オリジンなので、それぞれ異なるブラウザ保存値を持ちます。

## 起動とテスト

ローカルではHTTPサーバー経由で `index.html` を開きます。

```sh
npm run serve
```

バトルエンジンの自動テストは次のコマンドで実行できます。

```sh
npm test
```

Firebase未設定時は、ログイン画面の「この端末で対戦を試す」からCPU戦を利用できます。

## 同期方式

両プレイヤーのコマンドをターン番号ごとに保存し、入力が揃った時だけRealtime Databaseのトランザクション内でターンを解決します。バトルエンジンは時刻や端末乱数に依存せず、保存された乱数シードだけを更新するため、競合時も同じ入力から同じ状態が得られます。
