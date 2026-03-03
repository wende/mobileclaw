"use client";

import React, { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";

import { MessageRow } from "@/components/MessageRow";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";
import { ZenToggle } from "@/components/ZenToggle";
import { formatMessageTime, getMessageSide } from "@/lib/messageUtils";
import { STOP_REASON_INJECTED, isToolCallPart } from "@/lib/constants";
import { ZEN_SLIDE_MS, ZEN_FADE_MS, ZEN_TOGGLE_FRAME_MS } from "@/lib/chat/zenUi";
import type { ContentPart, Message } from "@/types/chat";
import type { useSubagentStore } from "@/hooks/useSubagentStore";

const TIME_GAP_THRESHOLD_MS = 10 * 60 * 1000;
const ZEN_COLLAPSE_TOTAL_MS = ZEN_TOGGLE_FRAME_MS + ZEN_FADE_MS + ZEN_SLIDE_MS;
const IOS_TOP_MESSAGE_SPACER_HEIGHT = "clamp(2.75rem, 6.5dvh, 3.75rem)";

interface ChatViewportProps {
  isDetached: boolean;
  isNative: boolean;
  historyLoaded: boolean;
  inputZoneHeight: string;
  bottomPad: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  pullContentRef: React.RefObject<HTMLDivElement | null>;
  pullSpinnerRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onNativeScrollPosition?: (distanceFromBottom: number) => void;
  displayMessages: Message[];
  sentAnimId: string | null;
  onSentAnimationEnd: () => void;
  fadeInIds: Set<string>;
  isStreaming: boolean;
  streamingId: string | null;
  subagentStore: ReturnType<typeof useSubagentStore>;
  pinnedToolCallId: string | null;
  onPin: (info: {
    toolCallId: string | null;
    childSessionKey: string | null;
    taskName: string;
    model: string | null;
  }) => void;
  onUnpin: () => void;
  zenMode: boolean;
  isRunActive: boolean;
  thinkingStartTime: number | null;
  thinkingLabel?: string;
  quotePopup: { x: number; y: number; text: string } | null;
  quotePopupRef: React.RefObject<HTMLButtonElement | null>;
  onAcceptQuote: (text: string) => void;
}

export function ChatViewport({
  isDetached,
  isNative,
  historyLoaded,
  inputZoneHeight,
  bottomPad,
  scrollRef,
  bottomRef,
  pullContentRef,
  pullSpinnerRef,
  onScroll,
  onNativeScrollPosition,
  displayMessages,
  sentAnimId,
  onSentAnimationEnd,
  fadeInIds,
  isStreaming,
  streamingId,
  subagentStore,
  pinnedToolCallId,
  onPin,
  onUnpin,
  zenMode,
  isRunActive,
  thinkingStartTime,
  thinkingLabel,
  quotePopup,
  quotePopupRef,
  onAcceptQuote,
}: ChatViewportProps) {
  const [zenRenderMode, setZenRenderMode] = useState(zenMode);
  const [expandedZenGroups, setExpandedZenGroups] = useState<Record<string, boolean>>({});
  const [collapsingZenGroups, setCollapsingZenGroups] = useState<Record<string, boolean>>({});
  const [zenGroupSlideOpen, setZenGroupSlideOpen] = useState<Record<string, boolean>>({});
  const [zenGroupFadeVisible, setZenGroupFadeVisible] = useState<Record<string, boolean>>({});
  const [zenRowSlideOpen, setZenRowSlideOpen] = useState<Record<string, boolean>>({});
  const [zenRowFadeVisible, setZenRowFadeVisible] = useState<Record<string, boolean>>({});
  const [deferredZenTailByGroup, setDeferredZenTailByGroup] = useState<Record<string, boolean>>({});
  const [zenTailFadeInGroups, setZenTailFadeInGroups] = useState<Set<string>>(new Set());
  const animationTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({});
  const rowAnimationTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({});
  const tailDeferTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const modeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const prevZenModeRef = useRef(zenMode);
  const prevStreamingRef = useRef(isStreaming);
  const prevZenMetaByMessageIdRef = useRef<Record<string, { groupId: string; isTail: boolean; hasMultiple: boolean }>>({});
  const prevZenTailIdsRef = useRef<Set<string>>(new Set());

  // Split single assistant messages that contain multiple completed tool-call cycles
  // into separate display messages. This lets the existing multi-message zen machinery
  // handle progressive collapse — exactly like demo mode's zenCycles approach.
  const { zenDisplayMessages, effectiveStreamingId } = useMemo(() => {
    if (!zenMode && !zenRenderMode) {
      return { zenDisplayMessages: displayMessages, effectiveStreamingId: streamingId };
    }
    const result: Message[] = [];
    let lastSplitStreamingId: string | null = null;

    for (const msg of displayMessages) {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
        result.push(msg);
        continue;
      }
      const parts = msg.content as ContentPart[];
      // Find positions where a completed tool call is followed by more content.
      const splitPoints: number[] = [];
      for (let i = 0; i < parts.length; i++) {
        if (isToolCallPart(parts[i]) && (parts[i].result != null || (parts[i].status && parts[i].status !== "running")) && i + 1 < parts.length) {
          splitPoints.push(i + 1);
        }
      }
      if (splitPoints.length === 0) {
        result.push(msg);
        continue;
      }
      let start = 0;
      let cycleIndex = 0;
      for (const splitAt of splitPoints) {
        const cycleId = cycleIndex === 0 ? msg.id! : `${msg.id}-cycle-${cycleIndex}`;
        result.push({ ...msg, id: cycleId, content: parts.slice(start, splitAt) });
        start = splitAt;
        cycleIndex++;
      }
      // Remaining parts (the last/active cycle)
      if (start < parts.length) {
        const lastId = cycleIndex === 0 ? msg.id! : `${msg.id}-cycle-${cycleIndex}`;
        result.push({ ...msg, id: lastId, content: parts.slice(start) });
        if (msg.id === streamingId) lastSplitStreamingId = lastId;
      }
    }

    return {
      zenDisplayMessages: result,
      effectiveStreamingId: lastSplitStreamingId ?? streamingId,
    };
  }, [displayMessages, streamingId, zenMode, zenRenderMode]);

  const zenGroupMeta = useMemo(() => {
    const byIndex = new Map<number, { groupId: string; isHead: boolean; isTail: boolean; hasMultiple: boolean }>();
    const groupIds: string[] = [];
    const multiGroupIds: string[] = [];
    let currentGroupId: string | null = null;
    let currentIndices: number[] = [];

    const flushGroup = () => {
      if (!currentGroupId || currentIndices.length === 0) return;
      const head = currentIndices[0];
      const tail = currentIndices[currentIndices.length - 1];
      const hasMultiple = currentIndices.length > 1;
      for (const idx of currentIndices) {
        byIndex.set(idx, { groupId: currentGroupId, isHead: idx === head, isTail: idx === tail, hasMultiple });
      }
      groupIds.push(currentGroupId);
      if (hasMultiple) multiGroupIds.push(currentGroupId);
      currentGroupId = null;
      currentIndices = [];
    };

    for (let idx = 0; idx < zenDisplayMessages.length; idx++) {
      const msg = zenDisplayMessages[idx];
      const isZenEligibleAssistant =
        msg.role === "assistant"
        && !msg.isCommandResponse
        && !msg.isContext
        && msg.stopReason !== STOP_REASON_INJECTED;

      if (!isZenEligibleAssistant) {
        continue;
      }

      const side = getMessageSide(msg.role);
      let prevNonCenterIdx = idx - 1;
      while (prevNonCenterIdx >= 0 && getMessageSide(zenDisplayMessages[prevNonCenterIdx].role) === "center") {
        prevNonCenterIdx -= 1;
      }
      const prevNonCenterMsg = prevNonCenterIdx >= 0 ? zenDisplayMessages[prevNonCenterIdx] : null;
      const prevSide = prevNonCenterMsg ? getMessageSide(prevNonCenterMsg.role) : null;
      const prevTimestamp = prevNonCenterMsg?.timestamp ?? null;
      const timGap = msg.timestamp && prevTimestamp ? msg.timestamp - prevTimestamp : 0;
      const isTimeGap = timGap > TIME_GAP_THRESHOLD_MS;
      const isNewTurn = side !== "center" && side !== prevSide;
      const prevNonEligibleAssistantBoundary = !!(
        prevNonCenterMsg
        && prevNonCenterMsg.role === "assistant"
        && (prevNonCenterMsg.isCommandResponse || prevNonCenterMsg.isContext || prevNonCenterMsg.stopReason === STOP_REASON_INJECTED)
      );
      const showTimestamp = side !== "center" && (isNewTurn || isTimeGap || prevNonEligibleAssistantBoundary);

      if (!currentGroupId || showTimestamp) {
        flushGroup();
        currentGroupId = msg.id ? `zen-${msg.id}` : `zen-idx-${idx}`;
      }
      currentIndices.push(idx);
    }
    flushGroup();
    return { byIndex, groupIds, multiGroupIds };
  }, [zenDisplayMessages]);

  const clearGroupTimers = useCallback((groupId: string) => {
    const timers = animationTimersRef.current[groupId];
    if (!timers) return;
    timers.forEach((timer) => clearTimeout(timer));
    delete animationTimersRef.current[groupId];
  }, []);

  const setGroupTimer = useCallback((groupId: string, timer: ReturnType<typeof setTimeout>) => {
    if (!animationTimersRef.current[groupId]) {
      animationTimersRef.current[groupId] = [];
    }
    animationTimersRef.current[groupId].push(timer);
  }, []);

  const clearRowTimers = useCallback((messageId: string) => {
    const timers = rowAnimationTimersRef.current[messageId];
    if (!timers) return;
    timers.forEach((timer) => clearTimeout(timer));
    delete rowAnimationTimersRef.current[messageId];
  }, []);

  const setRowTimer = useCallback((messageId: string, timer: ReturnType<typeof setTimeout>) => {
    if (!rowAnimationTimersRef.current[messageId]) {
      rowAnimationTimersRef.current[messageId] = [];
    }
    rowAnimationTimersRef.current[messageId].push(timer);
  }, []);

  const clearTailDeferTimer = useCallback((groupId: string) => {
    const timer = tailDeferTimersRef.current[groupId];
    if (!timer) return;
    clearTimeout(timer);
    delete tailDeferTimersRef.current[groupId];
  }, []);

  const deferZenTailRender = useCallback((groupId: string) => {
    clearTailDeferTimer(groupId);
    setDeferredZenTailByGroup((prev) => ({ ...prev, [groupId]: true }));
    tailDeferTimersRef.current[groupId] = setTimeout(() => {
      delete tailDeferTimersRef.current[groupId];
      setDeferredZenTailByGroup((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      // Mark group for tail fade-in animation
      setZenTailFadeInGroups((prev) => new Set(prev).add(groupId));
      setTimeout(() => {
        setZenTailFadeInGroups((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
      }, 300);
    }, ZEN_COLLAPSE_TOTAL_MS);
  }, [clearTailDeferTimer]);

  const clearModeTimers = useCallback(() => {
    modeTimersRef.current.forEach((timer) => clearTimeout(timer));
    modeTimersRef.current = [];
  }, []);

  const setModeTimer = useCallback((timer: ReturnType<typeof setTimeout>) => {
    modeTimersRef.current.push(timer);
  }, []);

  const demotingZenRows = useMemo(() => {
    const rowIds = new Set<string>();
    const groupIds = new Set<string>();
    if (!(zenMode && zenRenderMode && (isStreaming || prevStreamingRef.current))) return { rowIds, groupIds };

    for (let idx = 0; idx < zenDisplayMessages.length; idx++) {
      const msg = zenDisplayMessages[idx];
      if (!msg.id) continue;
      const zenMeta = zenGroupMeta.byIndex.get(idx);
      if (!zenMeta || !zenMeta.hasMultiple || zenMeta.isTail) continue;

      const prevMeta = prevZenMetaByMessageIdRef.current[msg.id];
      if (!prevMeta) continue;
      const wasTailInSameGroup = prevMeta.groupId === zenMeta.groupId && prevMeta.isTail;
      if (!wasTailInSameGroup) continue;

      const groupId = zenMeta.groupId;
      const groupExpanded = !!expandedZenGroups[groupId];
      const groupSlidingOpen = !!zenGroupSlideOpen[groupId];
      const groupCollapsing = !!collapsingZenGroups[groupId];
      const groupIsCollapsedVisual = !groupExpanded && !groupSlidingOpen && !groupCollapsing;
      if (!groupIsCollapsedVisual) continue;

      rowIds.add(msg.id);
      groupIds.add(groupId);
    }

    return { rowIds, groupIds };
  }, [
    collapsingZenGroups,
    zenDisplayMessages,
    expandedZenGroups,
    isStreaming,
    zenGroupMeta.byIndex,
    zenGroupSlideOpen,
    zenMode,
    zenRenderMode,
  ]);

  useEffect(() => {
    setExpandedZenGroups((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of zenGroupMeta.groupIds) {
        if (prev[id]) next[id] = true;
      }
      return next;
    });
    setCollapsingZenGroups((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of zenGroupMeta.groupIds) {
        if (prev[id]) next[id] = true;
      }
      return next;
    });
    setZenGroupSlideOpen((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of zenGroupMeta.groupIds) {
        if (prev[id]) next[id] = true;
      }
      return next;
    });
    setZenGroupFadeVisible((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of zenGroupMeta.groupIds) {
        if (prev[id]) next[id] = true;
      }
      return next;
    });
    setDeferredZenTailByGroup((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of zenGroupMeta.groupIds) {
        if (prev[id]) next[id] = true;
      }
      return next;
    });

    for (const groupId of Object.keys(animationTimersRef.current)) {
      if (!zenGroupMeta.groupIds.includes(groupId)) {
        clearGroupTimers(groupId);
      }
    }
    for (const groupId of Object.keys(tailDeferTimersRef.current)) {
      if (!zenGroupMeta.groupIds.includes(groupId)) {
        clearTailDeferTimer(groupId);
      }
    }
  }, [clearGroupTimers, clearTailDeferTimer, zenGroupMeta.groupIds]);

  useEffect(() => {
    const liveMessageIds = new Set(
      zenDisplayMessages
        .map((msg) => msg.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    );

    setZenRowSlideOpen((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, open] of Object.entries(prev)) {
        if (liveMessageIds.has(id)) next[id] = open;
        else changed = true;
      }
      return changed ? next : prev;
    });
    setZenRowFadeVisible((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [id, visible] of Object.entries(prev)) {
        if (liveMessageIds.has(id)) next[id] = visible;
        else changed = true;
      }
      return changed ? next : prev;
    });
    for (const messageId of Object.keys(rowAnimationTimersRef.current)) {
      if (!liveMessageIds.has(messageId)) {
        clearRowTimers(messageId);
      }
    }
  }, [clearRowTimers, zenDisplayMessages]);

  useEffect(() => {
    const wasZenMode = prevZenModeRef.current;
    if (wasZenMode === zenMode) return;
    prevZenModeRef.current = zenMode;

    clearModeTimers();
    for (const groupId of zenGroupMeta.multiGroupIds) {
      clearGroupTimers(groupId);
    }

    if (zenMode) {
      setZenRenderMode(true);

      if (zenGroupMeta.multiGroupIds.length === 0) return;

      setExpandedZenGroups((prev) => {
        const next = { ...prev };
        for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = false;
        return next;
      });
      setCollapsingZenGroups((prev) => {
        const next = { ...prev };
        for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = true;
        return next;
      });
      setZenGroupSlideOpen((prev) => {
        const next = { ...prev };
        for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = true;
        return next;
      });
      setZenGroupFadeVisible((prev) => {
        const next = { ...prev };
        for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = true;
        return next;
      });

      const fadeOutTimer = setTimeout(() => {
        setZenGroupFadeVisible((prev) => {
          const next = { ...prev };
          for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = false;
          return next;
        });
      }, ZEN_TOGGLE_FRAME_MS);
      const closeTimer = setTimeout(() => {
        setZenGroupSlideOpen((prev) => {
          const next = { ...prev };
          for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = false;
          return next;
        });
      }, ZEN_TOGGLE_FRAME_MS + ZEN_FADE_MS);
      const doneTimer = setTimeout(() => {
        setCollapsingZenGroups((prev) => {
          const next = { ...prev };
          for (const groupId of zenGroupMeta.multiGroupIds) delete next[groupId];
          return next;
        });
      }, ZEN_TOGGLE_FRAME_MS + ZEN_FADE_MS + ZEN_SLIDE_MS);

      setModeTimer(fadeOutTimer);
      setModeTimer(closeTimer);
      setModeTimer(doneTimer);
      return;
    }

    if (!zenRenderMode) return;

    if (zenGroupMeta.multiGroupIds.length === 0) {
      setZenRenderMode(false);
      return;
    }

    setExpandedZenGroups((prev) => {
      const next = { ...prev };
      for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = true;
      return next;
    });
    setCollapsingZenGroups((prev) => {
      const next = { ...prev };
      for (const groupId of zenGroupMeta.multiGroupIds) delete next[groupId];
      return next;
    });
    setZenGroupFadeVisible((prev) => {
      const next = { ...prev };
      for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = false;
      return next;
    });
    setZenGroupSlideOpen((prev) => {
      const next = { ...prev };
      for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = true;
      return next;
    });

    const fadeInTimer = setTimeout(() => {
      setZenGroupFadeVisible((prev) => {
        const next = { ...prev };
        for (const groupId of zenGroupMeta.multiGroupIds) next[groupId] = true;
        return next;
      });
    }, ZEN_SLIDE_MS);
    const doneTimer = setTimeout(() => {
      setZenRenderMode(false);
    }, ZEN_SLIDE_MS + ZEN_FADE_MS);

    setModeTimer(fadeInTimer);
    setModeTimer(doneTimer);
  }, [clearGroupTimers, clearModeTimers, setModeTimer, zenGroupMeta.multiGroupIds, zenMode, zenRenderMode]);

  useLayoutEffect(() => {
    const currentMetaByMessageId: Record<string, { groupId: string; isTail: boolean; hasMultiple: boolean }> = {};

    for (let idx = 0; idx < zenDisplayMessages.length; idx++) {
      const msg = zenDisplayMessages[idx];
      if (!msg.id) continue;
      const zenMeta = zenGroupMeta.byIndex.get(idx);
      if (!zenMeta) continue;
      currentMetaByMessageId[msg.id] = {
        groupId: zenMeta.groupId,
        isTail: zenMeta.isTail,
        hasMultiple: zenMeta.hasMultiple,
      };
    }

    if (zenMode && zenRenderMode && (isStreaming || prevStreamingRef.current)) {
      for (const [messageId, currentMeta] of Object.entries(currentMetaByMessageId)) {
        if (!currentMeta.hasMultiple || currentMeta.isTail) continue;
        if (!demotingZenRows.rowIds.has(messageId)) continue;
        if (rowAnimationTimersRef.current[messageId]) continue;
        if (zenRowSlideOpen[messageId] !== undefined || zenRowFadeVisible[messageId] !== undefined) continue;
        const prevMeta = prevZenMetaByMessageIdRef.current[messageId];
        if (!prevMeta) continue;
        const wasTailInSameGroup = prevMeta.groupId === currentMeta.groupId && prevMeta.isTail;
        if (!wasTailInSameGroup) continue;

        const groupId = currentMeta.groupId;
        const groupExpanded = !!expandedZenGroups[groupId];
        const groupSlidingOpen = !!zenGroupSlideOpen[groupId];
        const groupCollapsing = !!collapsingZenGroups[groupId];
        const groupIsCollapsedVisual = !groupExpanded && !groupSlidingOpen && !groupCollapsing;
        if (!groupIsCollapsedVisual) continue;

        clearRowTimers(messageId);
        setZenRowSlideOpen((prev) => ({ ...prev, [messageId]: true }));
        setZenRowFadeVisible((prev) => ({ ...prev, [messageId]: true }));

        const fadeTimer = setTimeout(() => {
          setZenRowFadeVisible((prev) => ({ ...prev, [messageId]: false }));
        }, ZEN_TOGGLE_FRAME_MS);
        const closeTimer = setTimeout(() => {
          setZenRowSlideOpen((prev) => ({ ...prev, [messageId]: false }));
        }, ZEN_TOGGLE_FRAME_MS + ZEN_FADE_MS);
        const cleanupTimer = setTimeout(() => {
          setZenRowSlideOpen((prev) => {
            const next = { ...prev };
            delete next[messageId];
            return next;
          });
          setZenRowFadeVisible((prev) => {
            const next = { ...prev };
            delete next[messageId];
            return next;
          });
        }, ZEN_TOGGLE_FRAME_MS + ZEN_FADE_MS + ZEN_SLIDE_MS);

        setRowTimer(messageId, fadeTimer);
        setRowTimer(messageId, closeTimer);
        setRowTimer(messageId, cleanupTimer);
        deferZenTailRender(groupId);
      }
    }

    // Detect new tails that appeared without going through the demotion/deferral flow.
    // This handles history replacement (where message IDs change, breaking group-ID matching)
    // and streaming-end transitions where the split creates a new cycle.
    if (zenMode && zenRenderMode && prevZenTailIdsRef.current.size > 0) {
      for (const [messageId, currentMeta] of Object.entries(currentMetaByMessageId)) {
        if (!currentMeta.isTail || !currentMeta.hasMultiple) continue;
        if (prevZenTailIdsRef.current.has(messageId)) continue;
        if (demotingZenRows.groupIds.has(currentMeta.groupId)) continue;
        if (deferredZenTailByGroup[currentMeta.groupId]) continue;
        if (zenTailFadeInGroups.has(currentMeta.groupId)) continue;
        setZenTailFadeInGroups((prev) => new Set(prev).add(currentMeta.groupId));
        setTimeout(() => {
          setZenTailFadeInGroups((prev) => {
            const next = new Set(prev);
            next.delete(currentMeta.groupId);
            return next;
          });
        }, 300);
      }
    }

    // Update tracking refs
    const currentTailIds = new Set<string>();
    for (const [id, meta] of Object.entries(currentMetaByMessageId)) {
      if (meta.isTail && meta.hasMultiple) currentTailIds.add(id);
    }
    prevZenTailIdsRef.current = currentTailIds;
    prevZenMetaByMessageIdRef.current = currentMetaByMessageId;
    prevStreamingRef.current = isStreaming;
  }, [
    clearRowTimers,
    collapsingZenGroups,
    deferredZenTailByGroup,
    demotingZenRows.groupIds,
    demotingZenRows.rowIds,
    zenDisplayMessages,
    expandedZenGroups,
    isStreaming,
    setRowTimer,
    zenRowFadeVisible,
    zenRowSlideOpen,
    deferZenTailRender,
    zenGroupMeta.byIndex,
    zenGroupSlideOpen,
    zenTailFadeInGroups,
    zenMode,
    zenRenderMode,
  ]);

  const handleToggleZenGroup = useCallback((groupId: string) => {
    clearGroupTimers(groupId);
    setExpandedZenGroups((prev) => {
      const wasExpanded = !!prev[groupId];
      const next = { ...prev, [groupId]: !wasExpanded };

      if (wasExpanded) {
        // Collapse sequence: fade out first, then slide closed.
        setCollapsingZenGroups((cPrev) => ({ ...cPrev, [groupId]: true }));
        setZenGroupFadeVisible((fPrev) => ({ ...fPrev, [groupId]: false }));
        setZenGroupSlideOpen((sPrev) => ({ ...sPrev, [groupId]: true }));
        const closeTimer = setTimeout(() => {
          setZenGroupSlideOpen((sPrev) => ({ ...sPrev, [groupId]: false }));
        }, ZEN_FADE_MS);
        const collapseDoneTimer = setTimeout(() => {
          setCollapsingZenGroups((cPrev) => {
            const cNext = { ...cPrev };
            delete cNext[groupId];
            return cNext;
          });
        }, ZEN_FADE_MS + ZEN_SLIDE_MS);
        setGroupTimer(groupId, closeTimer);
        setGroupTimer(groupId, collapseDoneTimer);
      } else {
        // Expand sequence: slide open first, then fade in.
        setCollapsingZenGroups((cPrev) => {
          const cNext = { ...cPrev };
          delete cNext[groupId];
          return cNext;
        });
        setZenGroupSlideOpen((sPrev) => ({ ...sPrev, [groupId]: true }));
        setZenGroupFadeVisible((fPrev) => ({ ...fPrev, [groupId]: false }));
        const fadeTimer = setTimeout(() => {
          setZenGroupFadeVisible((fPrev) => ({ ...fPrev, [groupId]: true }));
        }, ZEN_SLIDE_MS);
        setGroupTimer(groupId, fadeTimer);
      }

      return next;
    });
  }, [clearGroupTimers, setGroupTimer]);

  useEffect(() => {
    return () => {
      for (const timers of Object.values(animationTimersRef.current)) {
        timers.forEach((timer) => clearTimeout(timer));
      }
      animationTimersRef.current = {};
      for (const timers of Object.values(rowAnimationTimersRef.current)) {
        timers.forEach((timer) => clearTimeout(timer));
      }
      rowAnimationTimersRef.current = {};
      for (const timer of Object.values(tailDeferTimersRef.current)) {
        clearTimeout(timer);
      }
      tailDeferTimersRef.current = {};
      clearModeTimers();
    };
  }, [clearModeTimers]);

  return (
    <div ref={pullContentRef} className={`relative flex flex-1 flex-col min-h-0 ${isDetached ? "px-3 pt-3" : ""}`}>

      {!isNative && <div className={`pointer-events-none absolute z-20 h-7 opacity-60 ${isDetached ? "inset-x-3 rounded-b-2xl" : "inset-x-0"}`} style={{ bottom: isDetached ? inputZoneHeight : 0, background: "linear-gradient(to top, var(--background) 40%, transparent)" }} />}
      <main
        ref={scrollRef}
        onScroll={() => {
          onScroll();
          if (onNativeScrollPosition && scrollRef.current) {
            const el = scrollRef.current;
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            onNativeScrollPosition(distFromBottom);
          }
        }}
        className={`scrollbar-hide flex-1 overflow-y-auto overflow-x-hidden ${isNative ? "" : "bg-background"} ${isDetached ? "rounded-2xl" : "pt-14"}`}
        style={{ ...(isNative ? {} : { overscrollBehavior: "none" as const }), ...(isDetached ? { boxShadow: "0 -4px 6px -1px rgb(0 0 0 / 0.06), 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)" } : {}) }}
      >
        <div className={`mx-auto flex w-full ${isDetached || isNative ? "max-w-none" : "max-w-2xl"} flex-col gap-3 px-4 py-6 md:px-6 md:py-4 transition-opacity duration-300 ease-out ${historyLoaded ? "opacity-100" : "opacity-0"}`} style={{ paddingBottom: bottomPad }}>
          {isNative && <div aria-hidden="true" style={{ height: IOS_TOP_MESSAGE_SPACER_HEIGHT, flexShrink: 0 }} />}
          {zenDisplayMessages.map((msg, idx) => {
            const side = getMessageSide(msg.role);
            const prevSide = idx > 0 ? getMessageSide(zenDisplayMessages[idx - 1].role) : null;
            const prevTimestamp = idx > 0 ? zenDisplayMessages[idx - 1].timestamp : null;
            const isNewTurn = side !== "center" && side !== prevSide;
            const timGap = msg.timestamp && prevTimestamp ? msg.timestamp - prevTimestamp : 0;
            const isTimeGap = timGap > TIME_GAP_THRESHOLD_MS;
            const showTimestamp = side !== "center" && (isNewTurn || isTimeGap);
            const zenMeta = zenGroupMeta.byIndex.get(idx);
            const zenGroupExpanded = zenMeta ? !!expandedZenGroups[zenMeta.groupId] : false;
            const zenGroupCollapsing = zenMeta ? !!collapsingZenGroups[zenMeta.groupId] : false;
            const zenSlideOpen = zenMeta ? !!zenGroupSlideOpen[zenMeta.groupId] : false;
            const zenFadeVisible = zenMeta ? !!zenGroupFadeVisible[zenMeta.groupId] : false;
            const zenCollapsedVisual = !zenGroupExpanded && !zenSlideOpen && !zenGroupCollapsing;
            const isDemotingRowNow = !!(msg.id && demotingZenRows.rowIds.has(msg.id));
            const rowSlideOverride = msg.id ? zenRowSlideOpen[msg.id] : undefined;
            const rowFadeOverride = msg.id ? zenRowFadeVisible[msg.id] : undefined;
            const freezeStreamingLayout = !!(msg.id && (isDemotingRowNow || rowSlideOverride !== undefined || rowFadeOverride !== undefined));
            const effectiveRowSlideOpen = rowSlideOverride ?? (isDemotingRowNow ? true : zenSlideOpen);
            const effectiveRowFadeVisible = rowFadeOverride ?? (isDemotingRowNow ? true : zenFadeVisible);
            const deferTailRender = zenMode
              && zenRenderMode
              && !!zenMeta
              && zenMeta.hasMultiple
              && zenMeta.isTail
              && zenCollapsedVisual
              && (!!deferredZenTailByGroup[zenMeta.groupId] || demotingZenRows.groupIds.has(zenMeta.groupId));
            if (deferTailRender) return null;
            const showZenTimestampToggle = zenMode
              && !!zenMeta
              && zenMeta.hasMultiple
              && zenMeta.isHead;
            const zenToggleExpandedVisual = zenGroupExpanded || zenSlideOpen || zenGroupCollapsing;
            const isZenSiblingRow = zenRenderMode && !!zenMeta && zenMeta.hasMultiple && !zenMeta.isTail;
            const collapsedZenSibling = isZenSiblingRow && !effectiveRowSlideOpen;
            const isZenTailFadingIn = zenMeta?.isTail && zenMeta?.hasMultiple && zenTailFadeInGroups.has(zenMeta.groupId);
            // Immediate fade-in for tails that appeared due to history replacement
            // (where message IDs change and the layout effect hasn't set state yet)
            const isNewZenTail = !!(
              zenMeta?.isTail &&
              zenMeta?.hasMultiple &&
              !deferTailRender &&
              msg.id &&
              prevZenTailIdsRef.current.size > 0 &&
              !prevZenTailIdsRef.current.has(msg.id)
            );
            const messageAnimationStyle = !isZenSiblingRow
              ? msg.id === sentAnimId
                ? { animation: "messageSend 350ms cubic-bezier(0.34, 1.56, 0.64, 1) both", transformOrigin: "bottom right" }
                : (msg.id && fadeInIds.has(msg.id)) || isZenTailFadingIn || isNewZenTail
                  ? { animation: "fadeIn 250ms ease-out" }
                  : undefined
              : undefined;
            const messageRowWrapperStyle = isZenSiblingRow
              ? {
                marginBottom: collapsedZenSibling ? "-0.75rem" : undefined,
                transition: `margin-bottom ${ZEN_SLIDE_MS}ms ease-out`,
              }
              : messageAnimationStyle;
            return (
              <React.Fragment key={msg.id || idx}>
                {isTimeGap && !isNewTurn && !collapsedZenSibling && msg.timestamp && (
                  <div className="flex items-center justify-center gap-1 py-1">
                    <span className="text-2xs text-muted-foreground/60">{formatMessageTime(msg.timestamp)}</span>
                    {showZenTimestampToggle && zenMeta
                      ? (
                        <ZenToggle
                          expanded={zenToggleExpandedVisual}
                          onClick={() => handleToggleZenGroup(zenMeta.groupId)}
                          className="shrink-0"
                        />
                      )
                      : null}
                  </div>
                )}
                {showTimestamp && isNewTurn && !collapsedZenSibling && msg.timestamp && (
                  <div className={`flex items-center gap-1 ${side === "right" ? "justify-end" : "justify-start"}`}>
                    <p className={`text-2xs text-muted-foreground/60 ${side === "right" ? "text-right" : "text-left"}`}>
                      {formatMessageTime(msg.timestamp)}
                      {msg.role === "assistant" && msg.runDuration && msg.runDuration > 0 && (
                        <span className="ml-1">&middot; Worked for {msg.runDuration}s</span>
                      )}
                      {msg.role === "assistant" && !msg.runDuration && msg.thinkingDuration && msg.thinkingDuration > 0 && (
                        <span className="ml-1">&middot; {msg.thinkingDuration}s</span>
                      )}
                    </p>
                    {showZenTimestampToggle && zenMeta
                      ? (
                        <ZenToggle
                          expanded={zenToggleExpandedVisual}
                          onClick={() => handleToggleZenGroup(zenMeta.groupId)}
                          className="shrink-0"
                        />
                      )
                      : null}
                  </div>
                )}
                {showZenTimestampToggle && collapsedZenSibling && zenMeta && (
                  <div className={`flex items-center gap-1 ${side === "right" ? "justify-end" : "justify-start"}`}>
                    {msg.timestamp && (
                      <p className={`text-2xs text-muted-foreground/60 ${side === "right" ? "text-right" : "text-left"}`}>
                        {formatMessageTime(msg.timestamp)}
                        {msg.role === "assistant" && msg.runDuration && msg.runDuration > 0 && (
                          <span className="ml-1">&middot; Worked for {msg.runDuration}s</span>
                        )}
                        {msg.role === "assistant" && !msg.runDuration && msg.thinkingDuration && msg.thinkingDuration > 0 && (
                          <span className="ml-1">&middot; {msg.thinkingDuration}s</span>
                        )}
                      </p>
                    )}
                    <ZenToggle
                      expanded={zenToggleExpandedVisual}
                      onClick={() => handleToggleZenGroup(zenMeta.groupId)}
                      className="shrink-0"
                    />
                  </div>
                )}
                <div
                  style={messageRowWrapperStyle}
                  onAnimationEnd={!isZenSiblingRow && msg.id === sentAnimId ? onSentAnimationEnd : undefined}
                >
                  <MessageRow
                    message={msg}
                    isStreaming={isStreaming && msg.id === effectiveStreamingId}
                    freezeStreamingLayout={freezeStreamingLayout}
                    subagentStore={subagentStore}
                    pinnedToolCallId={pinnedToolCallId}
                    onPin={onPin}
                    onUnpin={onUnpin}
                    zenMode={zenRenderMode}
                    zenGroupCollapsible={false}
                    zenGroupExpanded={zenGroupExpanded}
                    zenCollapsedByGroup={isZenSiblingRow}
                    zenGroupSlideOpen={effectiveRowSlideOpen}
                    zenGroupFadeVisible={effectiveRowFadeVisible}
                    onZenGroupToggle={undefined}
                  />
                </div>
              </React.Fragment>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </main>
      <div className="pointer-events-none absolute inset-x-0 px-4 md:px-6" style={{ bottom: `calc(${inputZoneHeight} + 1.5rem)` }}>
        <div className="mx-auto w-full max-w-2xl pl-6">
          <ThinkingIndicator visible={isRunActive} startTime={thinkingStartTime ?? undefined} label={thinkingLabel} />
        </div>
      </div>

      {isDetached && !isNative && <div style={{ height: inputZoneHeight, flexShrink: 0 }} />}

      {!isDetached && !isNative && (
        <div
          ref={pullSpinnerRef}
          className="flex h-0 items-center justify-center gap-2 overflow-visible"
          style={{ opacity: 0, transform: "translateY(calc(-3dvh - 23px))" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground" style={{ animation: "none" }}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span className="text-sm leading-none">🦞</span>
        </div>
      )}

      {quotePopup && !isNative && (
        <button
          ref={quotePopupRef}
          type="button"
          className="fixed z-50 -translate-x-1/2 -translate-y-full flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg active:scale-95 transition-transform animate-[fadeIn_100ms_ease-out]"
          style={{ left: quotePopup.x, top: quotePopup.y - 8 }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAcceptQuote(quotePopup.text);
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
          </svg>
          Quote
        </button>
      )}
    </div>
  );
}
