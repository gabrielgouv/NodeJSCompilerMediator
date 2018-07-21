import { CompilationError } from '../errors/compilation-error'
import { CommandBuilder } from './command-builder'
import { ICompilerConfigs } from './compiler-configs'
import { CompilerConfigsParser } from './compiler-configs-parser'
import { ICompilerOptions } from './compiler-options'
import { CompilerLoader } from './compiler-loader'
import { Observable, Observer } from 'rxjs'
import { ProcessWrapper } from '../runtime/process-wrapper'
import { isCompilerOptions } from '../utils/type-guards'

export interface ICompilerOutput {
    returnCode?: number
    data?: string
    took?: number
}

export class Compiler {

    public readonly SUCCESS_CODE: number = 0

    private configs!: ICompilerConfigs

    constructor(obj: string | ICompilerOptions) {
        const parser = new CompilerConfigsParser(this.configs)
        if (isCompilerOptions(obj)) {
            this.configs = parser.fromCompilerOptions(obj)
        } else {
            this.configs = parser.fromString(obj)
        }
    }

    public executionTimeout(value: number): void {
        this.configs.executionTimeout = value
    }

    public putVariable(name: string, value: string | number | boolean): void {
        if (name.trim().length > 0) {
            this.configs.variables.set(name.trim(), value.toString())
        }
    }

    /**
     * When an input is requested at runtime, this method is called
     * @param inputs - Input lines.
     */
    public onInputRequested(...inputs: string[]): void {
        this.configs.inputs = inputs
    }

    /**
     * Starts the compiler.
     */
    public execute(): Observable<ICompilerOutput> {
        return Observable.create((observer: Observer<ICompilerOutput>) => {
            this.configureDefaultOptions()
            this.loadCompiler().subscribe((compiler) => {
                this.optionsParser(compiler)
                this.compileAndRun(observer)
            }, (error) => {
                observer.error(error)
            })
        })
    }

    private loadCompiler(): Observable<any> {
        return new CompilerLoader(this.configs.compilerName).getCompiler()
    }

    private compileAndRun(observer: Observer<ICompilerOutput>): void {
        this.compile().subscribe((compileOutput) => {
            if (compileOutput.returnCode === this.SUCCESS_CODE && this.configs.runCommand) {
                this.run(...this.configs.inputs).subscribe((runOutput) => {
                    observer.next(runOutput)
                    observer.complete()
                }, (error) => {
                    observer.error(error)
                })
            } else {
                if (!this.configs.runCommand) {
                    observer.error(new CompilationError('runCommand not found.'))
                } else if (compileOutput.returnCode !== 0) {
                    observer.next(compileOutput)
                    observer.complete()
                } else {
                    observer.error(new CompilationError('Failed to compile.'))
                }
            }
        })
    }

    private compile(): Observable<ICompilerOutput> {
        return Observable.create((observer: Observer<ICompilerOutput>) => {
            if (this.configs.compileCommand) {
                // Compile
                this.run(this.configs.compileCommand).subscribe((output) => {
                    observer.next(output)
                    observer.complete()
                }, (error) => {
                    observer.error(error)
                })
            } else {
                // No need to compile
                observer.next({
                    returnCode: this.SUCCESS_CODE,
                })
                observer.complete()
            }
        })
    }

    private run(...inputs: string[]): Observable<ICompilerOutput> {
        return Observable.create((observer: Observer<ICompilerOutput>) => {
            let result = ''
            let command = ''

            if (this.configs.runCommand) {
                command = this.configureCommand(this.configs.runCommand)
            } else {
                observer.error(new CompilationError('runCommand not found.'))
            }

            const proc = new ProcessWrapper(command, {
                currentDirectory: this.configs.filePath,
                executionTimeout: this.configs.executionTimeout,
            })

            const started = process.hrtime()

            if (inputs.length > 0) {
                proc.writeInput(...inputs)
            }
            proc.onOutput().subscribe((output) => {
                result += output
            })
            proc.onError().subscribe((error) => {
                result += error
            })
            proc.onFinish().subscribe((returnCode) => {
                const took = process.hrtime(started)
                observer.next({
                    data: result,
                    returnCode,
                    took: took[1] / 1000000,
                })
                observer.complete()
            })
        })
    }

    private configureCommand(command: string): string {
        const commandBuilder = new CommandBuilder(command)
        if (this.configs.variables) {
            commandBuilder.putVariables(this.configs.variables)
        }
        commandBuilder.putVariables(this.configs.variables)

        return commandBuilder.buildCommand()
    }

    private configureDefaultOptions(): void {
        this.configs.filePath = this.configs.filePath ? this.configs.filePath : './'
    }

    private optionsParser(compiler: any): void {
        this.configs.filePath = compiler.filePath
        this.configs.executionTimeout = this.configs.executionTimeout ?
                                        this.configs.executionTimeout : compiler.executionTimeout
        this.configs.compileCommand = compiler.compileCommand
        this.configs.runCommand = compiler.runCommand
    }

}
