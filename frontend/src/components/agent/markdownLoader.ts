import { lazy } from 'react'

const load = () => import('./MarkdownAnswer')

export const LazyMarkdownAnswer = lazy(load)

export const preloadMarkdown = () => void load()
