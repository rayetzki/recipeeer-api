import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UploadApiErrorResponse, UploadApiResponse } from 'cloudinary';
import { from, Observable, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { DeleteResult, Repository, UpdateResult } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { UserEntity } from './user.entity';
import { PaginatedUsers, User } from './user.interface';

@Injectable()
export class UserService {
    constructor(
        @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
        private readonly authService: AuthService,
        private readonly cloudinaryService: CloudinaryService
    ) { }

    create(user: User): Observable<User> {
        return this.authService
            .hashPassword(user.password)
            .pipe(switchMap((passwordHash: string) => {
                return from(this.userRepository.save({
                    ...user,
                    password: passwordHash
                })).pipe(map((user: User) => {
                    delete user.password;
                    return user;
                }), catchError(error => throwError(error)))
            }))
    }

    findAll(limit: number, offset: number): Observable<PaginatedUsers> {
        return from(this.userRepository
            .findAndCount({ skip: offset, take: limit }))
            .pipe(map(([users, count]) => {
                users.forEach((user: User) => delete user.password)
                return {
                    users,
                    totalItems: count,
                    itemCount: limit || users.length,
                    currentPage: offset,
                    itemsPerPage: offset ? offset * limit : count
                };
            }), catchError(error => throwError(error)));
    }

    findOne(id: string): Observable<User> {
        return from(this.userRepository.findOne(id)).pipe(
            map((user: User) => {
                delete user.password;
                return user;
            })
        );
    }

    search(name: string): Observable<User[]> {
        return from(this.userRepository.find({ where: { name } })).pipe(
            map((users: User[]) => users),
            catchError(error => throwError(error))
        );
    }

    updateOne(id: string, user: User): Observable<UpdateResult> {
        return from(this.userRepository.update(id, user))
    }

    updateRole(id: string, user: User): Observable<UpdateResult> {
        return from(this.userRepository.update(id, user));
    }

    deleteOne(id: string): Observable<DeleteResult> {
        return from(this.userRepository.delete(id));
    }

    uploadAvatar(id: string, avatar: string): Observable<User | BadRequestException> {
        const user: Observable<User> = from(this.findOne(id));
        return from(this.cloudinaryService.upload(avatar)).pipe(
            map((uploadResponse: UploadApiResponse) => {
                if (uploadResponse.created_at) {
                    this.updateOne(id, { avatar: uploadResponse.secure_url }).pipe(
                        map((updateResult: UpdateResult) => {
                            if (updateResult.affected === 1) {
                                return { ...user, avatar: uploadResponse.secure_url }
                            };
                        }),
                        catchError((error: UpdateResult) => throwError(error))
                    )
                } else return new BadRequestException("Sorry, couldnt add an avatar")
            }),
            catchError((error: UploadApiErrorResponse) => throwError(error))
        )
    }

    login(email: string, password: string): Observable<string> {
        return from(
            this.validate(email, password).pipe(switchMap((user: User) => {
                if (user) {
                    return this.authService.generateJWT(user).pipe(map((jwt: string) => jwt));
                } else {
                    throw new NotFoundException('User wasn\'t found');
                }
            }))
        )
    }

    validate(email: string, password: string): Observable<User> {
        return from(this.userRepository.findOne({ email })).pipe(
            switchMap((user: User) => {
                return this.authService
                    .comparePasswords(password, user.password)
                    .pipe(map((match: boolean) => {
                        if (match) {
                            delete user.password;
                            return user;
                        } else {
                            throw new BadRequestException('Password is not correct');
                        }
                    }))
            })
        )
    }
}
