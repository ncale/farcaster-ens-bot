export type User = {
    fid: number,
    username: string,
    total_followers?: string
}
  
export type UsernameHistory = {
    prevUsername: string,
    newUsername: string
}