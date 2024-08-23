import type { Plugin } from 'vite'
import path from 'path'
import fs from 'fs'

export type MergePublicOptions = {
	// vite 打包後的目錄絕對路徑，default: path.resolve(process.cwd(), 'dist')
	distDir?: string
	// 資源目錄放置的上層目錄絕對路徑，default: path.resolve(process.cwd(), 'public')
	publicDir?: string
	// 資源目錄合併後的目錄名，default: 'mp'
	mergeDir?: string
	// 資源目錄下要合併的目錄名
	dirNames: string[]
}

const PLUGIN_NAME = '@wymjs/vite-merge-public'
const FULL_PLUGIN_NAME = `vite-plugin-${PLUGIN_NAME}`
const CONSOLE_NAME = `[${PLUGIN_NAME}]`

function _checkCopyFile(from: string, to: string) {
	const toDirPath = to.replace(/[^\\\/]+$/, '')
	const exists = fs.existsSync(toDirPath)
	if (!exists) fs.mkdirSync(toDirPath, { recursive: true })
	fs.copyFileSync(from, to)
}

export function mergePublic(options: MergePublicOptions): any {
	const { distDir = 'dist', publicDir = 'public', mergeDir = 'mp', dirNames } = options || {}
	const publicRootPath = path.resolve(process.cwd(), publicDir)
	const absDirs = dirNames.map(e => path.resolve(publicRootPath, e))
	let buildPath: string
	let isBuild = false

	function _createMp(buildPath: string) {
		const exists = fs.existsSync(buildPath)

		if (exists) {
			fs.rmSync(buildPath, { recursive: true, force: true })
		} else {
			fs.mkdirSync(buildPath, { recursive: true })
		}

		for (let i = 0; i < absDirs.length; i++) {
			try {
				fs.cpSync(absDirs[i], buildPath, { recursive: true, force: true })
			} catch (err) {
				console.error(
					`[ERROR]${CONSOLE_NAME} 找不到 ${publicDir}/${dirNames[i]} 目錄，無法合併資源`,
				)
				console.error(err)
				process.exit(0)
			}
		}
	}

	const plugin: Plugin = {
		name: FULL_PLUGIN_NAME,
		enforce: 'pre',
		config(_, { command }) {
			console.log(`[LOG]${CONSOLE_NAME} 已開啟靜態資源合併功能...`)
			isBuild = command === 'build'

			if (!isBuild) {
				buildPath = path.resolve(publicRootPath, mergeDir)
				_createMp(buildPath)
				fs.writeFileSync(path.resolve(buildPath, './.gitignore'), '*')
			}

			return {
				publicDir: isBuild ? false : publicDir,
			}
		},
		closeBundle() {
			if (!isBuild) return
			_createMp(path.resolve(process.cwd(), distDir, mergeDir))
		},
		configureServer(server) {
			function onEvent(type: 'unlink' | 'add' | 'change') {
				return (filepath: string) => {
					if (!filepath.includes(publicRootPath)) return

					const firstWordReg = /^[\/\\]([^\\\/]+)/
					const noRootFilepath = filepath.substring(publicRootPath.length)
					const fileDir = noRootFilepath.match(firstWordReg)?.[1]
					const dirIdx = dirNames.findIndex(e => e === fileDir)

					if (dirIdx === -1) return

					const noDirFilepath = noRootFilepath.substring(1).substring(fileDir!.length + 1)

					if (type === 'unlink') {
						if (dirIdx === 0) {
							if (dirNames.length === 0) {
								fs.rmSync(path.resolve(buildPath, noDirFilepath))
							} else {
								for (let i = 1; i < dirNames.length; i++) {
									if (fs.existsSync(path.resolve(publicRootPath, dirNames[i], noDirFilepath))) {
										break
									} else if (i === dirNames.length - 1) {
										fs.rmSync(path.resolve(buildPath, noDirFilepath))
									}
								}
							}
							return
						}

						for (let i = dirIdx - 1; i >= 0; i--) {
							const dirFilepath = path.resolve(publicRootPath, dirNames[i], noDirFilepath)
							const exists = fs.existsSync(dirFilepath)

							if (exists) {
								_checkCopyFile(dirFilepath, path.resolve(buildPath, noDirFilepath))
								break
							} else if (i === 0) {
								fs.rmSync(path.resolve(buildPath, noDirFilepath))
							}
						}
					} else {
						for (let i = dirNames.length - 1; i >= 0; i--) {
							const exists = fs.existsSync(
								path.resolve(publicRootPath, dirNames[i], noDirFilepath),
							)

							if (exists) {
								if (dirIdx < i) break

								_checkCopyFile(filepath, path.resolve(buildPath, noDirFilepath))
								break
							} else if (i === 0) {
								_checkCopyFile(filepath, path.resolve(buildPath, noDirFilepath))
							}
						}
					}
				}
			}

			server.watcher.on('change', onEvent('change'))
			server.watcher.on('add', onEvent('add'))
			server.watcher.on('unlink', onEvent('unlink'))
		},
	}

	return plugin
}
