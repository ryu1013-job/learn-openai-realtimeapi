"use client";

import { useEffect, useRef, useState } from "react";
import { Conversation } from "🍥/lib/conversations";

// ヘルパー関数：イベントハンドラ内で安全に使用できるID生成関数
const generateUniqueId = () => {
  return `id-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

interface UseWebRTCAudioSessionReturn {
  status: string;
  isSessionActive: boolean;
  audioIndicatorRef: React.RefObject<HTMLDivElement | null>;
  startSession: () => Promise<void>;
  stopSession: () => void;
  handleStartStopClick: () => void;
  msgs: unknown[];
  currentVolume: number;
  conversation: Conversation[];
}

export default function useWebRTCAudioSession(
  voice: string,
): UseWebRTCAudioSessionReturn { 
  const [status, setStatus] = useState("");
  const [isSessionActive, setIsSessionActive] = useState(false);

  // ローカルマイク用のオーディオ参照
  const audioIndicatorRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // WebRTC参照
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);

  // すべての生イベント/メッセージを追跡
  const [msgs, setMsgs] = useState<any[]>([]);

  // メインの会話状態
  const [conversation, setConversation] = useState<Conversation[]>([]);

  // 関数呼び出し用（AI「ツール」）
  const functionRegistry = useRef<Record<string, Function>>({});

  // 音量分析（アシスタントのインバウンドオーディオ）
  const [currentVolume, setCurrentVolume] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const volumeIntervalRef = useRef<number | null>(null);

  /**
   * ここでは一時的なユーザーメッセージの**ID**のみを追跡します。
   * ユーザーが話している間、そのIDによって会話項目を更新します。
   */
  const ephemeralUserMessageIdRef = useRef<string | null>(null);
  
    /**
   * データチャネルを開いたときに設定し、サーバーにセッション更新を送信します。
   */
  function configureDataChannel(dataChannel: RTCDataChannel) {
    // セッション更新を送信
    const sessionUpdate = {
      type: "session.update",
      session: {
        modalities: ["audio", "text"],
        input_audio_transcription: {
          model: "whisper-1",
        },
      },
    };
    dataChannel.send(JSON.stringify(sessionUpdate));

    console.log("セッション更新送信:", sessionUpdate);

    // 言語設定メッセージを送信
    const languageMessage = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "日本語だけで話し、日本語で答える。日本語で応答し続けることが極めて重要です。もしユーザーが他の言語で話したとしても、日本語で応答する必要があります。",
          },
        ],
      },
    };
    dataChannel.send(JSON.stringify(languageMessage));
  }

  /**
   * 一時的なユーザーIDを返し、必要に応じて会話に新しい一時的なメッセージを作成します。
   */
  function getOrCreateEphemeralUserId(): string {
    let ephemeralId = ephemeralUserMessageIdRef.current;
    if (!ephemeralId) {
      // 堅牢なユニークIDを生成
      ephemeralId = generateUniqueId();
      ephemeralUserMessageIdRef.current = ephemeralId;

      const newMessage: Conversation = {
        id: ephemeralId,
        role: "user",
        text: "",
        timestamp: new Date().toISOString(),
        isFinal: false,
        status: "speaking",
      };

      // 一時的なアイテムを会話に追加
      setConversation((prev) => [...prev, newMessage]);
    }
    return ephemeralId;
  }

  /**
   * 一時的なユーザーメッセージ（ephemeralUserMessageIdRefにより）を部分的な変更で更新します。
   */
  function updateEphemeralUserMessage(partial: Partial<Conversation>) {
    const ephemeralId = ephemeralUserMessageIdRef.current;
    if (!ephemeralId) return; // 更新する一時的なユーザーメッセージがない

    setConversation((prev) =>
      prev.map((msg) => {
        if (msg.id === ephemeralId) {
          return { ...msg, ...partial };
        }
        return msg;
      }),
    );
  }

  /**
   * 次のユーザー発話が新たに始まるように、一時的なユーザーメッセージIDをクリアします。
   */
  function clearEphemeralUserMessage() {
    ephemeralUserMessageIdRef.current = null;
  }

  /**
   * メインデータチャネルメッセージハンドラー：サーバーからのイベントを解釈します。
   */
  async function handleDataChannelMessage(event: MessageEvent) {
    try {
      const msg = JSON.parse(event.data);
      console.log("データチャネルの受信メッセージ:", msg);

      switch (msg.type) {
        /**
         * ユーザーの発話開始
         */
        case "input_audio_buffer.speech_started": {
          getOrCreateEphemeralUserId();
          updateEphemeralUserMessage({ status: "speaking" });
          console.log("ユーザー発話開始 - 現在の会話状態:", conversation);
          break;
        }

        /**
         * ユーザーの発話停止
         */
        case "input_audio_buffer.speech_stopped": {
          // オプション: "stopped"に設定するか、単に"speaking"のままにしておくこともできます
          updateEphemeralUserMessage({ status: "speaking" });
          break;
        }

        /**
         * 音声バッファがコミットされた => "音声を処理中..."
         */
        case "input_audio_buffer.committed": {
          updateEphemeralUserMessage({
            text: "音声を処理中...",
            status: "processing",
          });
          break;
        }

        /**
         * ユーザー発話の部分的な文字起こし
         */
        case "conversation.item.input_audio_transcription": {
          const partialText =
            msg.transcript ?? msg.text ?? "ユーザーが話しています...";
          updateEphemeralUserMessage({
            text: partialText,
            status: "speaking",
            isFinal: false,
          });
          console.log("ユーザー発話の部分的な文字起こし - 更新後の会話状態:", conversation);
          break;
        }

        /**
         * ユーザー発話の最終文字起こし
         */
        case "conversation.item.input_audio_transcription.completed": {
          console.log("ユーザー発話の最終文字起こし:", msg.transcript);
          updateEphemeralUserMessage({
            text: msg.transcript || "",
            isFinal: true,
            status: "final",
          });
          clearEphemeralUserMessage();
          break;
        }

        /**
         * ストリーミングAI文字起こし（アシスタントの部分応答）
         */
        case "response.audio_transcript.delta": {
          const newMessage: Conversation = {
            id: generateUniqueId(),
            role: "assistant",
            text: msg.delta,
            timestamp: new Date().toISOString(),
            isFinal: false,
          };

          setConversation((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === "assistant" && !lastMsg.isFinal) {
              // 既存のアシスタント部分応答に追加
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...lastMsg,
                text: lastMsg.text + msg.delta,
              };
              console.log("アシスタント応答を更新:", updated[updated.length - 1].text);
              return updated;
            } else {
              // 新しいアシスタント部分応答を開始
              console.log("新しいアシスタント応答を開始:", newMessage.text);
              return [...prev, newMessage];
            }
          });
          break;
        }

        /**
         * 最後のアシスタントメッセージを最終的なものとしてマーク
         */
        case "response.audio_transcript.done": {
          setConversation((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            updated[updated.length - 1].isFinal = true;
            console.log("アシスタント応答が完了しました");
            return updated;
          });
          break;
        }

        default: {
          console.warn("処理されていないメッセージタイプ:", msg.type);
          break;
        }
      }

      // 常に生のメッセージをログに記録
      setMsgs((prevMsgs) => [...prevMsgs, msg]);
      return msg;
    } catch (error) {
      console.error("データチャネルメッセージの処理エラー:", error);
    }
  }

  /**
   * Next.jsエンドポイントから一時的なトークンを取得
   */
  async function getEphemeralToken() {
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(`一時的トークンの取得に失敗: ${response.status}`);
      }
      const data = await response.json();
      return data.client_secret.value;
    } catch (err) {
      console.error("getEphemeralTokenエラー:", err);
      throw err;
    }
  }

  /**
   * マイク入力のローカル音声可視化をセットアップします（ウェーブCSSの切り替え）。
   */
  function setupAudioVisualization(stream: MediaStream) {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    source.connect(analyzer);

    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateIndicator = () => {
      if (!audioContext) return;
      analyzer.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;

      // 音量がしきい値を超えたら"active"クラスを切り替え
      if (audioIndicatorRef.current) {
        audioIndicatorRef.current.classList.toggle("active", average > 30);
      }
      requestAnimationFrame(updateIndicator);
    };
    updateIndicator();

    audioContextRef.current = audioContext;
  }


  /**
   * アシスタントからの受信音声からRMS音量を計算
   */
  function getVolume(): number {
    if (!analyserRef.current) return 0;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const float = (dataArray[i] - 128) / 128;
      sum += float * float;
    }
    return Math.sqrt(sum / dataArray.length);
  }

  /**
   * 新しいセッションを開始:
   */
  async function startSession() {
    try {
      setStatus("マイクへのアクセスをリクエスト中...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      setupAudioVisualization(stream);

      setStatus("一時的トークンを取得中...");
      const ephemeralToken = await getEphemeralToken();

      setStatus("接続を確立中...");
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      // アシスタントのTTS受信用の非表示<audio>要素
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;

      // 受信トラック => アシスタントのTTS
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];

        // オプション: 受信音量を測定
        const audioCtx = new (window.AudioContext || window.AudioContext)();
        const src = audioCtx.createMediaStreamSource(event.streams[0]);
        const inboundAnalyzer = audioCtx.createAnalyser();
        inboundAnalyzer.fftSize = 256;
        src.connect(inboundAnalyzer);
        analyserRef.current = inboundAnalyzer;

        // 音量モニタリングを開始
        volumeIntervalRef.current = window.setInterval(() => {
          setCurrentVolume(getVolume());
        }, 100);
      };

      // 文字起こし用のデータチャネル
      const dataChannel = pc.createDataChannel("response");
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        console.log("データチャネル開通");
        configureDataChannel(dataChannel);
        
        // セッション開始時に会話履歴に初期メッセージを追加
        setConversation([{
          id: generateUniqueId(),
          role: "system",
          text: "セッションが開始されました。お話しください。",
          timestamp: new Date().toISOString(),
          isFinal: true,
        }]);
      };
      dataChannel.onmessage = handleDataChannelMessage;

      // ローカルマイクトラックを追加
      pc.addTrack(stream.getTracks()[0]);

      // オファーを作成しローカル記述を設定
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // SDPオファーをOpenAI Realtimeに送信
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const response = await fetch(`${baseUrl}?model=${model}&voice=${voice}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralToken}`,
          "Content-Type": "application/sdp",
        },
      });

      // リモート記述を設定
      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setIsSessionActive(true);
      setStatus("セッションが正常に確立されました！");
    } catch (err) {
      console.error("startSessionエラー:", err);
      setStatus(`エラー: ${err}`);
      stopSession();
    }
  }

  /**
   * セッションを停止してクリーンアップ
   */
  function stopSession() {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
    if (audioIndicatorRef.current) {
      audioIndicatorRef.current.classList.remove("active");
    }
    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current);
      volumeIntervalRef.current = null;
    }
    analyserRef.current = null;

    ephemeralUserMessageIdRef.current = null;

    setCurrentVolume(0);
    setIsSessionActive(false);
    setStatus("セッション停止");
    setMsgs([]);
    setConversation([]);
  }

  /**
   * 単一のボタンから開始/停止を切り替え
   */
  function handleStartStopClick() {
    if (isSessionActive) {
      stopSession();
    } else {
      startSession();
    }
  }

  // 会話状態が変更されたときにデバッグログを出力
  useEffect(() => {
    if (conversation.length > 0) {
      console.log("会話状態が更新されました:", conversation);
    }
  }, [conversation]);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => stopSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps（依存配列のルールを無視）
  }, []);

  return {
    status,
    isSessionActive,
    audioIndicatorRef,
    startSession,
    stopSession,
    handleStartStopClick,
    msgs,
    currentVolume,
    conversation,
  };
}
