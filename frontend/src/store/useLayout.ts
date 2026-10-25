import { create } from 'zustand'

export type MobileTab = 'graph' | 'chat'

const useLayout = create<{ tab: MobileTab; setTab: (tab: MobileTab) => void }>()((set) => ({
  tab: 'graph',
  setTab: (tab) => set({ tab }),
}))

export default useLayout
