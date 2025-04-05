"use client";

import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { cn, fetcher } from "@/lib/utils";
import { useChatContext } from "@/lib/chat/chat-context";

import {
  FolderIcon,
  MoreHorizontalIcon,
  PenIcon,
  TrashIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
} from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Chat } from "@/lib/db/schema";
import { Input } from "./ui/input";
import { Button, buttonVariants } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlusIcon } from "lucide-react";

type FolderWithChats = {
  id: string;
  name: string;
  chats: Chat[];
  isOpen: boolean;
};

function PureFolderItem({
  folder,
  onRename,
  onDelete,
  setOpenMobile,
}: {
  folder: FolderWithChats;
  onRename: (name: string) => void;
  onDelete: () => void;
  setOpenMobile: (open: boolean) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newName, setNewName] = useState(folder.name);
  const { id: currentChatId } = useParams();

  const handleRename = () => {
    onRename(newName);
    setIsEditing(false);
  };

  const MAX_FOLDER_CHATS_SHOWN = 5;

  return (
    <>
      <SidebarMenuItem
        className={buttonVariants({
          variant: "ghost",
          className: "bg-transparent hover:bg-background cursor-pointer",
        })}
      >
        <div className="flex items-center gap-2 w-full">
          <FolderIcon className="size-4" />
          {isEditing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRename();
              }}
              className="flex-1"
            >
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRename}
                autoFocus
                className="h-6"
              />
            </form>
          ) : (
            <span className="flex-1">{folder.name}</span>
          )}
        </div>

        <DropdownMenu modal={true}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              className="opacity-0 translate-y-1/4 group-hover/chat-item:opacity-100 data-[state=open]:opacity-100 absolute right-2"
              showOnHover={true}
            >
              <MoreHorizontalIcon />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="flex flex-col gap-2"
            side="right"
            align="start"
          >
            <DropdownMenuItem
              className={buttonVariants({
                variant: "ghost",
                className: "cursor-pointer",
              })}
              onSelect={() => setIsEditing(true)}
            >
              <PenIcon />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={buttonVariants({
                variant: "destructive",
                className: "cursor-pointer",
              })}
              onSelect={onDelete}
            >
              <TrashIcon />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      {folder.isOpen && (
        <div className="ml-4 flex flex-col gap-1">
          {folder.chats.slice(0, MAX_FOLDER_CHATS_SHOWN).map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              isActive={chat.id === currentChatId}
              onDelete={() => {}}
              onRename={() => {}}
              onArchive={() => {}}
              onMove={() => {}}
              setOpenMobile={setOpenMobile}
            />
          ))}
        </div>
      )}
    </>
  );
}

const FolderItem = memo(PureFolderItem);

function PureChatItem({
  chat,
  isActive,
  onDelete,
  onRename,
  onArchive,
  onMove,
  setOpenMobile,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: () => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onMove: (folderId: string | null) => void;
  setOpenMobile: (open: boolean) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [newTitle, setNewTitle] = useState(chat.title);
  const { data: foldersResponse } = useSWR<{
    data: Array<FolderWithChats>;
    error: string | null;
    status: number;
  }>("/api/folders", fetcher);

  const folders = foldersResponse?.data || [];

  const handleRename = () => {
    onRename(newTitle);
    setIsEditing(false);
  };

  return (
    <SidebarMenuItem
      className={cn(
        buttonVariants({
          variant: "ghost",
          className: "bg-transparent hover:bg-background",
        }),
        "flex min-h-[2.5rem] group/chat-item relative p-0 items-center",
        {
          "bg-muted": isActive,
        }
      )}
    >
      <SidebarMenuButton
        className="flex-1 h-full flex items-center"
        asChild
        isActive={isActive}
      >
        {isEditing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleRename();
            }}
            className="flex-1 px-2"
          >
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onBlur={handleRename}
              autoFocus
              className="h-6"
            />
          </form>
        ) : (
          <Link
            href={`/chat/${chat.id}`}
            onClick={() => setOpenMobile(false)}
            className="flex-1 px-2 py-1.5"
          >
            <span>{chat.title}</span>
          </Link>
        )}
      </SidebarMenuButton>

      <DropdownMenu modal={true}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            className="opacity-0 translate-y-1/4 group-hover/chat-item:opacity-100 data-[state=open]:opacity-100 absolute right-2"
            showOnHover={!isActive}
          >
            <MoreHorizontalIcon className="size-4" />
            <span className="sr-only">More options</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          side="bottom"
          align="start"
          className="flex flex-col gap-2"
        >
          <DropdownMenuItem
            className={buttonVariants({
              variant: "ghost",
              className: "cursor-pointer justify-start",
            })}
            onSelect={() => setIsEditing(true)}
          >
            <PenIcon />
            <span>Rename</span>
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className={buttonVariants({
                variant: "ghost",
                className: "cursor-pointer flex items-center justify-start",
              })}
            >
              <FolderIcon className="size-4" />
              <span>Move to folder</span>
            </DropdownMenuSubTrigger>

            <DropdownMenuSubContent className="flex flex-col gap-2">
              {folders.length === 0 && (
                <DropdownMenuItem
                  className={buttonVariants({
                    variant: "ghost",
                    className: "cursor-pointer",
                  })}
                  disabled
                  onSelect={() => onMove(null)}
                >
                  <span>No folder</span>
                </DropdownMenuItem>
              )}

              {folders.map((folder) => (
                <DropdownMenuItem
                  key={folder.id}
                  onSelect={() => onMove(folder.id)}
                  className={buttonVariants({
                    variant: "ghost",
                    className: "cursor-pointer justify-start",
                  })}
                >
                  <span>{folder.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            className={buttonVariants({
              variant: "ghost",
              className: "cursor-pointer justify-start",
            })}
            onSelect={onArchive}
          >
            {chat.archived ? (
              <>
                <ArchiveRestoreIcon className="size-4" />
                <span>Unarchive</span>
              </>
            ) : (
              <>
                <ArchiveIcon className="size-4" />
                <span>Archive</span>
              </>
            )}
          </DropdownMenuItem>

          <DropdownMenuSeparator className="w-11/12 bg-border mx-auto" />

          <DropdownMenuItem
            onSelect={onDelete}
            className={buttonVariants({
              variant: "destructive",
              className: "cursor-pointer justify-start",
            })}
          >
            <TrashIcon />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export const ChatItem = memo(PureChatItem);

function groupChatsByDate(chats: Chat[]) {
  return chats.reduce(
    (groups, chat) => {
      const date = new Date(chat.created_at);

      if (isToday(date)) {
        groups.today.push(chat);
      } else if (isYesterday(date)) {
        groups.yesterday.push(chat);
      } else if (date > subWeeks(new Date(), 1)) {
        groups.lastWeek.push(chat);
      } else if (date > subMonths(new Date(), 1)) {
        groups.lastMonth.push(chat);
      } else {
        groups.older.push(chat);
      }

      return groups;
    },
    {
      today: [] as Chat[],
      yesterday: [] as Chat[],
      lastWeek: [] as Chat[],
      lastMonth: [] as Chat[],
      older: [] as Chat[],
    }
  );
}

export function SidebarHistory() {
  const { setOpenMobile } = useSidebar();
  const { id } = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const { refreshHistory } = useChatContext();

  const {
    data: response,
    isLoading,
    mutate,
  } = useSWR<{
    data: Array<Chat>;
    error: string | null;
    status: number;
  }>("/api/chat", fetcher, {
    fallbackData: { data: [], error: null, status: 200 },
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 0,
    dedupingInterval: 2000,
  });

  const {
    data: foldersResponse = { data: [], error: null, status: 200 },
    mutate: mutateFolders,
  } = useSWR<{
    data: Array<FolderWithChats>;
    error: string | null;
    status: number;
  }>("/api/folders", fetcher, {
    fallbackData: { data: [], error: null, status: 200 },
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 2000,
  });

  const folders = foldersResponse.data;

  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{
    type: "chat" | "folder";
    id: string;
  } | null>(null);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const history = response?.data || [];

  useEffect(() => {
    if (pathname === "/") {
      mutate();
      mutateFolders();
    }
  }, [pathname, mutate, mutateFolders]);

  // Refresh data when navigating to any chat route
  useEffect(() => {
    // Check if we're on a chat route
    if (pathname.startsWith("/chat/")) {
      // If the ID in the URL doesn't match any in our current list, this might be a new chat
      const chatIdFromUrl = pathname.split("/").pop();
      const chatExists = response?.data?.some(
        (chat) => chat.id === chatIdFromUrl
      );

      if (!chatExists) {
        // This could be a new chat that's not in our list yet, so refresh
        mutate();
      }
    }
  }, [pathname, response?.data, mutate]);

  const handleDelete = async () => {
    if (!deleteTarget) return;

    const endpoint = deleteTarget.type === "chat" ? "chat" : "folders";
    const deletePromise = fetch(`/api/${endpoint}?id=${deleteTarget.id}`, {
      method: "DELETE",
    }).then(async (res) => {
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete");
      }
      return res.json();
    });

    toast.promise(deletePromise, {
      loading: `Deleting ${deleteTarget.type}...`,
      success: () => {
        if (deleteTarget.type === "chat") {
          mutate((prev) =>
            prev
              ? {
                  ...prev,
                  data: prev.data.filter((h) => h.id !== deleteTarget.id),
                }
              : prev
          );
          if (deleteTarget.id === id) {
            router.push("/", { scroll: false });
            setTimeout(() => {
              router.refresh();
            }, 100);
          }
        } else {
          mutateFolders((prev) => {
            if (!prev) return prev;
            return {
              data: prev.data.filter((f) => f.id !== deleteTarget.id),
              error: null,
              status: 200,
            };
          });
        }

        // Use our context to refresh all chat-related data
        refreshHistory();

        return `${deleteTarget.type} deleted successfully`;
      },
      error: (error) =>
        `Failed to delete ${deleteTarget.type}: ${error.message}`,
    });

    setShowDeleteDialog(false);
    setDeleteTarget(null);
  };

  const handleUpdateChat = async (chatId: string, updates: any) => {
    const updatePromise = fetch(`/api/chat?id=${chatId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    toast.promise(updatePromise, {
      loading: "Updating chat...",
      success: () => {
        mutate();
        refreshHistory();
        return "Chat updated successfully";
      },
      error: "Failed to update chat",
    });
  };

  const handleUpdateFolder = async (folderId: string, name: string) => {
    const updatePromise = fetch(`/api/folder?id=${folderId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    toast.promise(updatePromise, {
      loading: "Updating folder...",
      success: () => {
        mutateFolders();
        refreshHistory();
        return "Folder updated successfully";
      },
      error: "Failed to update folder",
    });
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;

    const createPromise = fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolderName }),
    });

    toast.promise(createPromise, {
      loading: "Creating folder...",
      success: () => {
        mutateFolders();
        refreshHistory();
        setShowFolderModal(false);
        setNewFolderName("");
        return "Folder created successfully";
      },
      error: "Failed to create folder",
    });
  };

  if (isLoading) {
    return <SkeletonHistory />;
  }

  const nonArchivedChats = history?.filter((chat) => !chat.archived) || [];
  const archivedChats = history?.filter((chat) => chat.archived) || [];

  // Filter out chats that are in folders
  const nonFolderChats = nonArchivedChats.filter((chat) => !chat.folder_id);
  const groupedChats = groupChatsByDate(nonFolderChats);

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {/* Folders Section */}
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-sidebar-foreground/50 font-semibold">
                Folders
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-4"
                onClick={() => setShowFolderModal(true)}
              >
                <PlusIcon className="size-3" />
                <span className="sr-only">Create folder</span>
              </Button>
            </div>
            {folders.map((folder) => (
              <FolderItem
                key={folder.id}
                folder={{
                  ...folder,
                  isOpen: openFolders[folder.id] ?? true,
                }}
                onRename={(name) => handleUpdateFolder(folder.id, name)}
                onDelete={() => {
                  setDeleteTarget({ type: "folder", id: folder.id });
                  setShowDeleteDialog(true);
                }}
                setOpenMobile={setOpenMobile}
              />
            ))}

            {/* Today's Chats */}
            {groupedChats.today.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs text-sidebar-foreground/50 font-semibold mt-6">
                  Today
                </div>
                {groupedChats.today.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === id}
                    onDelete={() => {
                      setDeleteTarget({ type: "chat", id: chat.id });
                      setShowDeleteDialog(true);
                    }}
                    onRename={(title) => handleUpdateChat(chat.id, { title })}
                    onArchive={() =>
                      handleUpdateChat(chat.id, { archived: !chat.archived })
                    }
                    onMove={(folderId) =>
                      handleUpdateChat(chat.id, { folder_id: folderId })
                    }
                    setOpenMobile={setOpenMobile}
                  />
                ))}
              </>
            )}

            {/* Yesterday's Chats */}
            {groupedChats.yesterday.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs text-sidebar-foreground/50 font-semibold mt-6">
                  Yesterday
                </div>
                {groupedChats.yesterday.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === id}
                    onDelete={() => {
                      setDeleteTarget({ type: "chat", id: chat.id });
                      setShowDeleteDialog(true);
                    }}
                    onRename={(title) => handleUpdateChat(chat.id, { title })}
                    onArchive={() =>
                      handleUpdateChat(chat.id, { archived: !chat.archived })
                    }
                    onMove={(folderId) =>
                      handleUpdateChat(chat.id, { folder_id: folderId })
                    }
                    setOpenMobile={setOpenMobile}
                  />
                ))}
              </>
            )}

            {/* Last Week's Chats */}
            {groupedChats.lastWeek.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs text-sidebar-foreground/50 font-semibold mt-6">
                  Previous 7 Days
                </div>
                {groupedChats.lastWeek.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === id}
                    onDelete={() => {
                      setDeleteTarget({ type: "chat", id: chat.id });
                      setShowDeleteDialog(true);
                    }}
                    onRename={(title) => handleUpdateChat(chat.id, { title })}
                    onArchive={() =>
                      handleUpdateChat(chat.id, { archived: !chat.archived })
                    }
                    onMove={(folderId) =>
                      handleUpdateChat(chat.id, { folder_id: folderId })
                    }
                    setOpenMobile={setOpenMobile}
                  />
                ))}
              </>
            )}

            {/* Last Month's Chats */}
            {groupedChats.lastMonth.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs text-sidebar-foreground/50 font-semibold mt-6">
                  Previous 30 Days
                </div>
                {groupedChats.lastMonth.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === id}
                    onDelete={() => {
                      setDeleteTarget({ type: "chat", id: chat.id });
                      setShowDeleteDialog(true);
                    }}
                    onRename={(title) => handleUpdateChat(chat.id, { title })}
                    onArchive={() =>
                      handleUpdateChat(chat.id, { archived: !chat.archived })
                    }
                    onMove={(folderId) =>
                      handleUpdateChat(chat.id, { folder_id: folderId })
                    }
                    setOpenMobile={setOpenMobile}
                  />
                ))}
              </>
            )}

            {/* Older Chats */}
            {groupedChats.older.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs text-sidebar-foreground/50 font-semibold mt-6">
                  Older
                </div>
                {groupedChats.older.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === id}
                    onDelete={() => {
                      setDeleteTarget({ type: "chat", id: chat.id });
                      setShowDeleteDialog(true);
                    }}
                    onRename={(title) => handleUpdateChat(chat.id, { title })}
                    onArchive={() =>
                      handleUpdateChat(chat.id, { archived: !chat.archived })
                    }
                    onMove={(folderId) =>
                      handleUpdateChat(chat.id, { folder_id: folderId })
                    }
                    setOpenMobile={setOpenMobile}
                  />
                ))}
              </>
            )}

            {/* Archived Chats */}
            {archivedChats.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs text-sidebar-foreground/50 font-semibold mt-6">
                  Archived
                </div>
                {archivedChats.map((chat) => (
                  <ChatItem
                    key={chat.id}
                    chat={chat}
                    isActive={chat.id === id}
                    onDelete={() => {
                      setDeleteTarget({ type: "chat", id: chat.id });
                      setShowDeleteDialog(true);
                    }}
                    onRename={(title) => handleUpdateChat(chat.id, { title })}
                    onArchive={() =>
                      handleUpdateChat(chat.id, { archived: !chat.archived })
                    }
                    onMove={(folderId) =>
                      handleUpdateChat(chat.id, { folder_id: folderId })
                    }
                    setOpenMobile={setOpenMobile}
                  />
                ))}
              </>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {/* Create Folder Modal */}
      <Dialog open={showFolderModal} onOpenChange={setShowFolderModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              Folder name
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Enter folder name"
              className="w-full"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowFolderModal(false);
                setNewFolderName("");
              }}
            >
              Cancel
            </Button>
            <Button variant="secondary" onClick={handleCreateFolder}>
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete your
              {deleteTarget?.type} and remove it from our servers.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SkeletonHistory() {
  return (
    <SidebarGroup>
      <div className="px-2 py-1 text-xs text-sidebar-foreground/50 font-semibold">
        Today
      </div>
      <SidebarGroupContent>
        <div className="flex flex-col">
          {[44, 32, 28, 64, 52].map((item) => (
            <div
              key={item}
              className="rounded-md h-8 flex gap-2 px-2 items-center"
            >
              <div
                className="h-4 rounded-md flex-1 max-w-[--skeleton-width] bg-sidebar-accent-foreground/10"
                style={
                  {
                    "--skeleton-width": `${item}%`,
                  } as React.CSSProperties
                }
              />
            </div>
          ))}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
