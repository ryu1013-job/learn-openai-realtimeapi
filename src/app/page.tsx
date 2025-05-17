/* eslint-disable unused-imports/no-unused-vars */
'use client'

import { Badge } from '🍥/components/ui/badge'
import { Button } from '🍥/components/ui/button'
import { Heading } from '🍥/components/ui/heading'
import useWebRTCAudioSession from '🍥/hooks/use-webrtc'
import Image from 'next/image'
import { useState } from 'react'

export default function Home() {
  // State for voice selection
  const [voice, setVoice] = useState('ash')

  // WebRTC Audio Session Hook
  const {
    status,
    isSessionActive,
    handleStartStopClick,
    msgs,
    conversation,
  } = useWebRTCAudioSession(voice)

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <header>
        <Heading level={1}>Learn Realtime API with Next.js</Heading>
      </header>
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start w-full max-w-3xl">
        <div className="flex gap-2 items-center">
          <Badge>{status}</Badge>
        </div>

        <Button onClick={handleStartStopClick} intent={isSessionActive ? 'danger' : 'primary'}>
          {isSessionActive ? 'Stop' : 'Start'}
          {' '}
          Session
        </Button>

        <div className="w-full border rounded-lg p-4 bg-slate-50">
          <h2 className="text-lg font-semibold mb-4">会話履歴</h2>
          {conversation.length > 0
            ? (
                <div className="space-y-4">
                  {conversation.map(msg => (
                    <div
                      key={msg.id}
                      className={`p-3 rounded-lg ${
                        msg.role === 'user'
                          ? 'bg-blue-100 ml-8'
                          : msg.role === 'assistant' ? 'bg-green-100 mr-8' : 'bg-gray-100'
                      }`}
                    >
                      <div className="font-medium mb-1">
                        {msg.role === 'user'
                          ? 'ユーザー'
                          : msg.role === 'assistant' ? 'アシスタント' : 'システム'}
                        {msg.status && (
                          <span className="text-xs ml-2 text-gray-500">
                            {msg.status === 'speaking'
                              ? '（話し中）'
                              : msg.status === 'processing' ? '（処理中）' : ''}
                          </span>
                        )}
                      </div>
                      <div>{msg.text || '...'}</div>
                    </div>
                  ))}
                </div>
              )
            : (
                <p className="text-gray-500">会話が開始されるとここに表示されます。</p>
              )}
        </div>
      </main>
      <footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://platform.openai.com/docs/api-reference/realtime"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/file.svg"
            alt="File icon"
            width={16}
            height={16}
          />
          API Reference
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://platform.openai.com/docs/guides/realtime"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/window.svg"
            alt="Window icon"
            width={16}
            height={16}
          />
          Examples
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://platform.openai.com/playground/realtime"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/globe.svg"
            alt="Globe icon"
            width={16}
            height={16}
          />
          Playground
        </a>
      </footer>
    </div>
  )
}
